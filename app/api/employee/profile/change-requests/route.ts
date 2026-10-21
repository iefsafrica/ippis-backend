import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import {
  EDITABLE_FIELDS,
  type EditableField,
  validateField,
  currentProfileValues,
  emailTaken,
} from "@/lib/employee-profile";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// The employee's own change requests, newest first
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT id, status, changes, employee_note, review_note, reviewed_at, created_at
      FROM employee_profile_change_requests
      WHERE employee_id = ${auth.ctx.employee.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("EMPLOYEE CHANGE REQUESTS LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your change requests" }, 500);
  }
}

// Body: { changes: { phone?, email?, address?, ... }, note? }
// Nothing changes on the record until HR approves.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { changes?: Record<string, unknown>; note?: unknown };
    if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) {
      return withCors(req, { success: false, error: "changes is required" }, 400);
    }

    const submitted = Object.keys(body.changes);
    const notAllowed = submitted.filter((field) => !(field in EDITABLE_FIELDS));
    if (notAllowed.length > 0) {
      return withCors(req, {
        success: false,
        error: `These fields cannot be changed here: ${notAllowed.join(", ")}. Contact HR for other changes.`,
        editableFields: Object.keys(EDITABLE_FIELDS),
      }, 400);
    }

    const errors: Record<string, string> = {};
    const cleaned: Partial<Record<EditableField, string>> = {};
    for (const field of submitted as EditableField[]) {
      const result = validateField(field, body.changes[field]);
      if ("error" in result) errors[field] = result.error;
      else cleaned[field] = result.value;
    }
    if (Object.keys(errors).length > 0) {
      return withCors(req, { success: false, error: "Some values are not valid", fields: errors }, 400);
    }

    // Record what each field is changing from, and drop fields that would not change
    const current = await currentProfileValues(employee.id);
    const changes: Record<string, { from: string | null; to: string }> = {};
    for (const [field, value] of Object.entries(cleaned) as [EditableField, string][]) {
      if ((current[field] ?? "") !== value) changes[field] = { from: current[field], to: value };
    }
    if (Object.keys(changes).length === 0) {
      return withCors(req, { success: false, error: "Nothing would change: the values match your current record" }, 400);
    }

    if (changes.email && (await emailTaken(changes.email.to, employee.id))) {
      return withCors(req, { success: false, error: "That email address is already used by another employee", fields: { email: "Already in use" } }, 409);
    }

    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;

    let created;
    try {
      [created] = await db.transaction([
        db`
          INSERT INTO employee_profile_change_requests (employee_id, changes, employee_note)
          VALUES (${employee.id}, ${JSON.stringify(changes)}::jsonb, ${note})
          RETURNING id, status, changes, employee_note, created_at
        `,
        employeeAuditStatement(req, employee, "employee.profile.change_requested", { fields: Object.keys(changes) }),
      ]);
    } catch (error: any) {
      // The partial unique index allows one pending request per employee
      if (error?.code === "23505") {
        return withCors(req, {
          success: false,
          error: "You already have a change request waiting for HR. Cancel it or wait for a decision before sending another.",
        }, 409);
      }
      throw error;
    }

    return withCors(req, {
      success: true,
      message: "Your changes have been sent to HR for approval",
      data: created?.[0],
    }, 201);
  } catch (error) {
    console.error("EMPLOYEE CHANGE REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to submit your changes" }, 500);
  }
}

// ?id=  Cancels the employee's own request while it is still pending
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return withCors(req, { success: false, error: "id is required" }, 400);
    }

    const updated = await db`
      UPDATE employee_profile_change_requests
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND employee_id = ${employee.id} AND status = 'pending'
      RETURNING id
    `;
    if (!updated[0]) {
      return withCors(req, { success: false, error: "No pending request with that id" }, 404);
    }

    await employeeAuditStatement(req, employee, "employee.profile.change_cancelled", { request_id: id });
    return withCors(req, { success: true, message: "Change request cancelled" });
  } catch (error) {
    console.error("EMPLOYEE CHANGE REQUEST CANCEL ERROR:", error);
    return withCors(req, { success: false, error: "Failed to cancel the request" }, 500);
  }
}
