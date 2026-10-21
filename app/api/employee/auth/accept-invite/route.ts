import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { WINDOW_MS, IP_LIMIT } from "@/lib/admin-otp";
import {
  hashLinkToken,
  passwordProblem,
  signEmployeeToken,
  employeeAuditStatement,
} from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { token, password }
// The token comes from the invite email. Setting the password activates the
// account and signs the employee in.
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
      SELECT e.id, e.name, e.email, e.status AS employee_status, a.token_version
      FROM employee_accounts a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.invite_token_hash = ${hashLinkToken(body.token)}
        AND a.invite_expires_at > NOW()
        AND a.status = 'invited'
    `;
    const employee = rows[0];
    if (!employee) {
      return withCors(req, {
        success: false,
        message: "This invite link is invalid or has expired. Ask HR to send a new one.",
      }, 400);
    }
    if (String(employee.employee_status).toLowerCase() !== "active") {
      return withCors(req, { success: false, message: "Account is not active. Contact HR." }, 403);
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
            status = 'active',
            invite_token_hash = NULL,
            invite_expires_at = NULL,
            password_changed_at = NOW(),
            last_login_at = NOW(),
            updated_at = NOW()
        WHERE employee_id = ${employee.id} AND status = 'invited'
      `,
      employeeAuditStatement(req, { id: String(employee.id), name: String(employee.name) }, "employee.account.activated"),
    ]);

    return withCors(req, {
      success: true,
      message: "Password set. Your account is active.",
      token: signEmployeeToken(String(employee.id), Number(employee.token_version)),
      employee: { id: employee.id, name: employee.name, email: employee.email },
    });
  } catch (error) {
    console.error("EMPLOYEE ACCEPT INVITE ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong. Try again." }, 500);
  }
}
