import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// The signed-in employee, for the portal header and session checks
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT last_login_at, password_changed_at
      FROM employee_accounts WHERE employee_id = ${auth.ctx.employee.id}
    `;

    return withCors(req, {
      success: true,
      data: {
        ...auth.ctx.employee,
        lastLoginAt: rows[0]?.last_login_at ?? null,
        passwordChangedAt: rows[0]?.password_changed_at ?? null,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE ME ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your account" }, 500);
  }
}
