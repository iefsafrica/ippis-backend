import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { WINDOW_MS, IP_LIMIT } from "@/lib/admin-otp";
import { hashLinkToken, passwordProblem, employeeAuditStatement } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { token, password }
// The token comes from the reset email. Every existing session ends, so the
// employee signs in again with the new password.
export async function POST(req: NextRequest) {
  try {
    const byIp = hit(`employee-link:ip:${clientIp(req)}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, "Too many attempts. Try again later.");
    }

    const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
    if (typeof body.token !== "string" || !body.token) {
      return withCors(req, { success: false, message: "token is required" }, 400);
    }

    const rows = await db`
      SELECT e.id, e.name, e.email
      FROM employee_accounts a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.reset_token_hash = ${hashLinkToken(body.token)}
        AND a.reset_expires_at > NOW()
        AND a.status = 'active'
        AND LOWER(e.status) = 'active'
    `;
    const employee = rows[0];
    if (!employee) {
      return withCors(req, {
        success: false,
        message: "This reset link is invalid or has expired. Request a new one.",
      }, 400);
    }

    const problem = passwordProblem(body.password, { id: String(employee.id), email: String(employee.email) });
    if (problem) {
      return withCors(req, { success: false, message: problem }, 400);
    }

    const passwordHash = await bcrypt.hash(body.password as string, 10);

    await db.transaction([
      db`
        UPDATE employee_accounts
        SET password_hash = ${passwordHash},
            reset_token_hash = NULL,
            reset_expires_at = NULL,
            password_changed_at = NOW(),
            token_version = token_version + 1,
            updated_at = NOW()
        WHERE employee_id = ${employee.id}
      `,
      employeeAuditStatement(req, { id: String(employee.id), name: String(employee.name) }, "employee.password.reset"),
    ]);

    return withCors(req, { success: true, message: "Password changed. Sign in with your new password." });
  } catch (error) {
    console.error("EMPLOYEE RESET PASSWORD ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong. Try again." }, 500);
  }
}
