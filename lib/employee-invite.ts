import { neon } from "@neondatabase/serverless";
import { newLinkToken, portalLink, INVITE_VALID_HOURS } from "@/lib/employee-auth";
import { sendEmployeeInviteEmail } from "@lib/email";

const sql = neon(process.env.DATABASE_URL!);

export type InviteResult =
  | { ok: true; email: string; name: string; resent: boolean }
  | { ok: false; status: number; error: string };

/**
 * Invites an employee to the employee portal: creates (or refreshes) their
 * portal account and emails a link to set a password. Used when HR sends an
 * invite and when a registration is approved.
 *
 * Never throws; the caller decides whether a failure matters.
 */
export async function inviteToPortal(employeeId: string, invitedBy: string): Promise<InviteResult> {
  try {
    const rows = await sql`
      SELECT e.id, e.name, e.email, e.status, a.status AS account_status
      FROM employees e
      LEFT JOIN employee_accounts a ON a.employee_id = e.id
      WHERE e.id = ${employeeId}
    `;
    const employee = rows[0];
    if (!employee) return { ok: false, status: 404, error: "Employee not found" };
    if (String(employee.status).toLowerCase() !== "active") {
      return { ok: false, status: 409, error: `Only active employees can be invited (status is '${employee.status}')` };
    }
    if (!employee.email) return { ok: false, status: 409, error: "Employee has no email address on record" };
    if (employee.account_status === "active") {
      return {
        ok: false,
        status: 409,
        error: "Employee already has an active account. They can use 'Forgot password' if they cannot sign in.",
      };
    }
    if (employee.account_status === "suspended" || employee.account_status === "deactivated") {
      return { ok: false, status: 409, error: `Account is ${employee.account_status}. Reactivate it before sending a new invite.` };
    }

    const { token, hash } = newLinkToken();
    await sql`
      INSERT INTO employee_accounts (employee_id, status, invite_token_hash, invite_expires_at, invited_by, invited_at)
      VALUES (${employeeId}, 'invited', ${hash}, NOW() + make_interval(hours => ${INVITE_VALID_HOURS}), ${invitedBy}, NOW())
      ON CONFLICT (employee_id) DO UPDATE SET
        invite_token_hash = EXCLUDED.invite_token_hash,
        invite_expires_at = EXCLUDED.invite_expires_at,
        invited_by = EXCLUDED.invited_by,
        invited_at = EXCLUDED.invited_at,
        updated_at = NOW()
      WHERE employee_accounts.status = 'invited'
    `;

    try {
      await sendEmployeeInviteEmail(String(employee.email), String(employee.name), portalLink("set-password", token));
    } catch (emailError) {
      console.error("EMPLOYEE INVITE EMAIL ERROR:", emailError);
      return {
        ok: false,
        status: 502,
        error: "The invite was created but the email could not be sent. Check the SMTP settings and send it again.",
      };
    }

    return { ok: true, email: String(employee.email), name: String(employee.name), resent: employee.account_status === "invited" };
  } catch (error) {
    console.error("EMPLOYEE INVITE ERROR:", error);
    return { ok: false, status: 500, error: "Failed to invite employee" };
  }
}
