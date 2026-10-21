import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { normalisePhone } from "@/lib/employee-profile";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const MAX_CONTACTS = 5;
const PHONE = /^\+?\d{7,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type ContactInput = {
  name?: unknown;
  relationship?: unknown;
  phone?: unknown;
  alternate_phone?: unknown;
  email?: unknown;
  address?: unknown;
  is_primary?: unknown;
};

type Contact = {
  name: string;
  relationship: string;
  phone: string;
  alternate_phone: string | null;
  email: string | null;
  address: string | null;
};

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Checks a contact. With `partial`, only the fields present are checked. */
function validate(input: ContactInput, partial: boolean): { contact: Partial<Contact> } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const contact: Partial<Contact> = {};
  const has = (key: keyof ContactInput) => !partial || input[key] !== undefined;

  if (has("name")) {
    const name = str(input.name);
    if (name.length < 2 || name.length > 255) fields.name = "Name must be 2 to 255 characters";
    else contact.name = name;
  }
  if (has("relationship")) {
    const relationship = str(input.relationship);
    if (relationship.length < 2 || relationship.length > 50) fields.relationship = "Relationship must be 2 to 50 characters";
    else contact.relationship = relationship;
  }
  if (has("phone")) {
    const phone = normalisePhone(str(input.phone));
    if (!PHONE.test(phone)) fields.phone = "Phone must be 7 to 15 digits, optionally starting with +";
    else contact.phone = phone;
  }
  if (input.alternate_phone !== undefined) {
    const alt = normalisePhone(str(input.alternate_phone));
    if (alt && !PHONE.test(alt)) fields.alternate_phone = "Alternate phone must be 7 to 15 digits";
    else contact.alternate_phone = alt || null;
  }
  if (input.email !== undefined) {
    const email = str(input.email).toLowerCase();
    if (email && (email.length > 255 || !EMAIL.test(email))) fields.email = "Email address is not valid";
    else contact.email = email || null;
  }
  if (input.address !== undefined) {
    const address = str(input.address);
    if (address.length > 255) fields.address = "Address must be at most 255 characters";
    else contact.address = address || null;
  }
  if (input.is_primary !== undefined && typeof input.is_primary !== "boolean") {
    fields.is_primary = "is_primary must be true or false";
  }

  return Object.keys(fields).length > 0 ? { fields } : { contact };
}

async function listContacts(employeeId: string) {
  return db`
    SELECT id, name, relationship, phone, alternate_phone, email, address, is_primary, created_at, updated_at
    FROM employee_emergency_contacts
    WHERE employee_id = ${employeeId}
    ORDER BY is_primary DESC, created_at ASC
  `;
}

// The employee's own emergency contacts, primary first
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    return withCors(req, { success: true, data: await listContacts(auth.ctx.employee.id) });
  } catch (error) {
    console.error("EMERGENCY CONTACTS LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your emergency contacts" }, 500);
  }
}

// Body: { name, relationship, phone, alternate_phone?, email?, address?, is_primary? }
// The first contact becomes primary automatically.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const input = (await req.json().catch(() => ({}))) as ContactInput;
    const result = validate(input, false);
    if ("fields" in result) {
      return withCors(req, { success: false, error: "Some values are not valid", fields: result.fields }, 400);
    }
    const contact = result.contact as Contact;

    const count = await db`SELECT COUNT(*)::int AS n FROM employee_emergency_contacts WHERE employee_id = ${employee.id}`;
    const existing = count[0]?.n ?? 0;
    if (existing >= MAX_CONTACTS) {
      return withCors(req, { success: false, error: `You can keep up to ${MAX_CONTACTS} emergency contacts` }, 409);
    }
    const primary = existing === 0 || input.is_primary === true;

    const statements = [];
    if (primary) {
      statements.push(db`UPDATE employee_emergency_contacts SET is_primary = FALSE, updated_at = NOW() WHERE employee_id = ${employee.id} AND is_primary`);
    }
    statements.push(db`
      INSERT INTO employee_emergency_contacts (employee_id, name, relationship, phone, alternate_phone, email, address, is_primary)
      VALUES (${employee.id}, ${contact.name}, ${contact.relationship}, ${contact.phone},
              ${contact.alternate_phone ?? null}, ${contact.email ?? null}, ${contact.address ?? null}, ${primary})
    `);
    statements.push(employeeAuditStatement(req, employee, "employee.emergency_contact.added", { name: contact.name }));
    await db.transaction(statements);

    return withCors(req, { success: true, message: "Emergency contact added", data: await listContacts(employee.id) }, 201);
  } catch (error) {
    console.error("EMERGENCY CONTACT ADD ERROR:", error);
    return withCors(req, { success: false, error: "Failed to add the emergency contact" }, 500);
  }
}

// Body: { id, ...fields to change }. is_primary: true moves "primary" to this contact.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const input = (await req.json().catch(() => ({}))) as ContactInput & { id?: unknown };
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) {
      return withCors(req, { success: false, error: "id is required" }, 400);
    }

    const result = validate(input, true);
    if ("fields" in result) {
      return withCors(req, { success: false, error: "Some values are not valid", fields: result.fields }, 400);
    }
    const c = result.contact;

    const found = await db`SELECT is_primary FROM employee_emergency_contacts WHERE id = ${id} AND employee_id = ${employee.id}`;
    if (!found[0]) {
      return withCors(req, { success: false, error: "Emergency contact not found" }, 404);
    }
    if (input.is_primary === false && found[0].is_primary) {
      return withCors(req, { success: false, error: "Make another contact primary instead of removing primary from this one" }, 400);
    }

    const statements = [];
    if (input.is_primary === true && !found[0].is_primary) {
      statements.push(db`UPDATE employee_emergency_contacts SET is_primary = FALSE, updated_at = NOW() WHERE employee_id = ${employee.id} AND is_primary`);
    }
    statements.push(db`
      UPDATE employee_emergency_contacts
      SET name = COALESCE(${c.name ?? null}, name),
          relationship = COALESCE(${c.relationship ?? null}, relationship),
          phone = COALESCE(${c.phone ?? null}, phone),
          alternate_phone = CASE WHEN ${input.alternate_phone !== undefined} THEN ${c.alternate_phone ?? null} ELSE alternate_phone END,
          email = CASE WHEN ${input.email !== undefined} THEN ${c.email ?? null} ELSE email END,
          address = CASE WHEN ${input.address !== undefined} THEN ${c.address ?? null} ELSE address END,
          is_primary = is_primary OR ${input.is_primary === true},
          updated_at = NOW()
      WHERE id = ${id} AND employee_id = ${employee.id}
    `);
    statements.push(employeeAuditStatement(req, employee, "employee.emergency_contact.updated", { contact_id: id }));
    await db.transaction(statements);

    return withCors(req, { success: true, message: "Emergency contact updated", data: await listContacts(employee.id) });
  } catch (error) {
    console.error("EMERGENCY CONTACT UPDATE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the emergency contact" }, 500);
  }
}

// ?id=  Removes a contact. If it was primary, the oldest remaining one becomes primary.
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return withCors(req, { success: false, error: "id is required" }, 400);
    }

    const removed = await db`
      DELETE FROM employee_emergency_contacts
      WHERE id = ${id} AND employee_id = ${employee.id}
      RETURNING is_primary, name
    `;
    if (!removed[0]) {
      return withCors(req, { success: false, error: "Emergency contact not found" }, 404);
    }

    if (removed[0].is_primary) {
      await db`
        UPDATE employee_emergency_contacts SET is_primary = TRUE, updated_at = NOW()
        WHERE id = (
          SELECT id FROM employee_emergency_contacts
          WHERE employee_id = ${employee.id}
          ORDER BY created_at ASC LIMIT 1
        )
      `;
    }
    await employeeAuditStatement(req, employee, "employee.emergency_contact.removed", { name: removed[0].name });

    return withCors(req, { success: true, message: "Emergency contact removed", data: await listContacts(employee.id) });
  } catch (error) {
    console.error("EMERGENCY CONTACT DELETE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to remove the emergency contact" }, 500);
  }
}
