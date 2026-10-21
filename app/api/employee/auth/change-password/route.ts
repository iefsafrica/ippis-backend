import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, tooManyRequests } from "@/lib/rate-limit";
import { WINDOW_MS, PASSWORD_FAILURE_LIMIT } from "@/lib/admin-otp";
import {
  authenticateEmployee,
  passwordProblem,
  signEmployeeToken,
  employeeAuditStatement,
} from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { current_password, new_password }
// Other sessions end; the response carries a fresh token for this one.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { current_password?: string; new_password?: string };
    if (typeof body.current_password !== "string" || typeof body.new_password !== "string") {
      return withCors(req, { success: false, message: "current_password and new_password are required" }, 400);
    }

    const attempts = hit(`employee-change-password:${employee.id}`, PASSWORD_FAILURE_LIMIT, WINDOW_MS);
    if (!attempts.allowed) {
      return tooManyRequests(req, attempts.retryAfter, "Too many attempts. Try again later.");
    }

    const rows = await db`SELECT password_hash FROM employee_accounts WHERE employee_id = ${employee.id}`;
    const current = rows[0]?.password_hash;
    if (!current || !(await bcrypt.compare(body.current_password, current))) {
      return withCors(req, { success: false, message: "Current password is incorrect" }, 400);
    }

    const problem = passwordProblem(body.new_password, employee);
    if (problem) {
      return withCors(req, { success: false, message: problem }, 400);
    }
    if (await bcrypt.compare(body.new_password, current)) {
      return withCors(req, { success: false, message: "New password must be different from the current one" }, 400);
    }

    const passwordHash = await bcrypt.hash(body.new_password, 10);

    const [updated] = await db.transaction([
      db`
        UPDATE employee_accounts
        SET password_hash = ${passwordHash},
            password_changed_at = NOW(),
            token_version = token_version + 1,
            reset_token_hash = NULL,
            updated_at = NOW()
        WHERE employee_id = ${employee.id}
        RETURNING token_version
      `,
      employeeAuditStatement(req, employee, "employee.password.changed"),
    ]);

    return withCors(req, {
      success: true,
      message: "Password changed. Other sessions have been signed out.",
      token: signEmployeeToken(employee.id, Number(updated?.[0]?.token_version)),
    });
  } catch (error) {
    console.error("EMPLOYEE CHANGE PASSWORD ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong. Try again." }, 500);
  }
}
