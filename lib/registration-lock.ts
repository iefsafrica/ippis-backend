import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * The public registration steps take only an IPPIS (registration) number, with
 * no sign-in, so they must not change an application HR has already approved:
 * approval copied it into an employee record. Rejected applications stay open,
 * because rejection invites the applicant to reapply.
 */

export const APPROVED_LOCKED =
  "This application has been approved and can no longer be changed here. Contact HR, or sign in to the employee portal.";

export async function isApprovedApplication(registrationId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM employees WHERE registration_id = ${registrationId} LIMIT 1`;
  return rows.length > 0;
}

/** The email an application was submitted with, while it waits for a decision. */
export async function submittedEmail(registrationId: string): Promise<string | null> {
  const rows = await sql`SELECT email FROM pending_employees WHERE registration_id = ${registrationId} LIMIT 1`;
  const email = rows[0]?.email;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}
