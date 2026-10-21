import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Profile fields an employee may ask to change through the portal. Anything
 * else (name, date of birth, bank details, grade, employment data) stays with HR.
 */
export const EDITABLE_FIELDS = {
  phone: "Phone number",
  email: "Email address",
  address: "Residential address",
  state_of_residence: "State of residence",
  marital_status: "Marital status",
  next_of_kin_name: "Next of kin name",
  next_of_kin_relationship: "Next of kin relationship",
  next_of_kin_phone: "Next of kin phone number",
  next_of_kin_address: "Next of kin address",
} as const;

export type EditableField = keyof typeof EDITABLE_FIELDS;
export type ProfileValues = Record<EditableField, string | null>;

export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Separated"];

const PHONE = /^\+?\d{7,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalisePhone(value: string) {
  return value.replace(/[\s\-()]/g, "");
}

function text(value: string, label: string, min: number, max: number): { value: string } | { error: string } {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < min) return { error: `${label} must be at least ${min} characters` };
  if (trimmed.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: trimmed };
}

function phone(value: string, label: string): { value: string } | { error: string } {
  const cleaned = normalisePhone(value);
  return PHONE.test(cleaned) ? { value: cleaned } : { error: `${label} must be 7 to 15 digits, optionally starting with +` };
}

/** Checks and tidies one submitted value. */
export function validateField(field: EditableField, raw: unknown): { value: string } | { error: string } {
  const label = EDITABLE_FIELDS[field];
  if (typeof raw !== "string" || !raw.trim()) return { error: `${label} cannot be empty` };

  switch (field) {
    case "phone":
    case "next_of_kin_phone":
      return phone(raw, label);
    case "email": {
      const email = raw.trim().toLowerCase();
      if (email.length > 255 || !EMAIL.test(email)) return { error: "Email address is not valid" };
      return { value: email };
    }
    case "marital_status": {
      const match = MARITAL_STATUSES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
      return match ? { value: match } : { error: `Marital status must be one of: ${MARITAL_STATUSES.join(", ")}` };
    }
    case "state_of_residence":
      return text(raw, label, 2, 100);
    case "next_of_kin_name":
      return text(raw, label, 2, 255);
    case "next_of_kin_relationship":
      return text(raw, label, 2, 50);
    case "address":
    case "next_of_kin_address":
      return text(raw, label, 5, 255);
  }
}

/**
 * The employee's current values for the editable fields: portal-approved
 * values first, then the onboarding record, then the employee row.
 */
export async function currentProfileValues(employeeId: string): Promise<ProfileValues> {
  const rows = await sql`
    SELECT e.email,
           COALESCE(c.phone, p.phone_number) AS phone,
           COALESCE(c.address, p.address_state_of_residence) AS address,
           COALESCE(c.state_of_residence, p.state_of_residence) AS state_of_residence,
           COALESCE(c.marital_status, p.marital_status) AS marital_status,
           COALESCE(c.next_of_kin_name, p.next_of_kin_name) AS next_of_kin_name,
           COALESCE(c.next_of_kin_relationship, p.next_of_kin_relationship) AS next_of_kin_relationship,
           COALESCE(c.next_of_kin_phone, p.next_of_kin_phone_number) AS next_of_kin_phone,
           COALESCE(c.next_of_kin_address, p.next_of_kin_address) AS next_of_kin_address
    FROM employees e
    LEFT JOIN employee_contact_info c ON c.employee_id = e.id
    LEFT JOIN personal_info p ON p.registration_id = e.registration_id
    WHERE e.id = ${employeeId}
  `;
  const row = rows[0] ?? {};
  const values = {} as ProfileValues;
  for (const field of Object.keys(EDITABLE_FIELDS) as EditableField[]) {
    values[field] = row[field] == null ? null : String(row[field]);
  }
  return values;
}

/**
 * Statements that apply approved changes. Run them in one transaction.
 * personal_info is updated only where the employee has an onboarding row;
 * employee_contact_info always holds the result.
 */
export function applyChangeStatements(
  employeeId: string,
  current: ProfileValues,
  changes: Partial<Record<EditableField, string>>,
  requestId: number
) {
  const next = { ...current, ...changes };
  const statements = [
    sql`
      INSERT INTO employee_contact_info (
        employee_id, phone, address, state_of_residence, marital_status,
        next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, next_of_kin_address,
        last_request_id, updated_at
      )
      VALUES (
        ${employeeId}, ${next.phone}, ${next.address}, ${next.state_of_residence}, ${next.marital_status},
        ${next.next_of_kin_name}, ${next.next_of_kin_relationship}, ${next.next_of_kin_phone}, ${next.next_of_kin_address},
        ${requestId}, NOW()
      )
      ON CONFLICT (employee_id) DO UPDATE SET
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        state_of_residence = EXCLUDED.state_of_residence,
        marital_status = EXCLUDED.marital_status,
        next_of_kin_name = EXCLUDED.next_of_kin_name,
        next_of_kin_relationship = EXCLUDED.next_of_kin_relationship,
        next_of_kin_phone = EXCLUDED.next_of_kin_phone,
        next_of_kin_address = EXCLUDED.next_of_kin_address,
        last_request_id = EXCLUDED.last_request_id,
        updated_at = NOW()
    `,
    // Keep the onboarding record that admin screens read in step
    sql`
      UPDATE personal_info p
      SET phone_number = COALESCE(${changes.phone ?? null}, p.phone_number),
          email = COALESCE(${changes.email ?? null}, p.email),
          address_state_of_residence = COALESCE(${changes.address ?? null}, p.address_state_of_residence),
          state_of_residence = COALESCE(${changes.state_of_residence ?? null}, p.state_of_residence),
          marital_status = COALESCE(${changes.marital_status ?? null}, p.marital_status),
          next_of_kin_name = COALESCE(${changes.next_of_kin_name ?? null}, p.next_of_kin_name),
          next_of_kin_relationship = COALESCE(${changes.next_of_kin_relationship ?? null}, p.next_of_kin_relationship),
          next_of_kin_phone_number = COALESCE(${changes.next_of_kin_phone ?? null}, p.next_of_kin_phone_number),
          next_of_kin_address = COALESCE(${changes.next_of_kin_address ?? null}, p.next_of_kin_address)
      FROM employees e
      WHERE e.id = ${employeeId} AND p.registration_id = e.registration_id
    `,
  ];

  if (changes.email) {
    // The email is also the sign-in name and where portal emails go
    statements.push(sql`UPDATE employees SET email = ${changes.email}, updated_at = NOW() WHERE id = ${employeeId}`);
  }
  return statements;
}

/** True when another employee already uses this email. */
export async function emailTaken(email: string, employeeId: string) {
  const rows = await sql`SELECT 1 FROM employees WHERE LOWER(email) = LOWER(${email}) AND id <> ${employeeId} LIMIT 1`;
  return rows.length > 0;
}
