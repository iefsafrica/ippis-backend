import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { leaveBalances } from "@/lib/employee-leave";
import { todayLagos } from "@/lib/employee-time";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?employee_id=&year=  An employee's leave balances, for HR
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.leaves.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employee_id");
    const year = Number(searchParams.get("year") || todayLagos().slice(0, 4));
    if (!employeeId) return withCors(req, { success: false, error: "employee_id is required" }, 400);
    if (!Number.isInteger(year)) return withCors(req, { success: false, error: "year is not valid" }, 400);

    const employee = await db`SELECT id, name FROM employees WHERE id = ${employeeId}`;
    if (!employee[0]) return withCors(req, { success: false, error: "Employee not found" }, 404);

    return withCors(req, { success: true, data: { employee: employee[0], year, balances: await leaveBalances(employeeId, year) } });
  } catch (error) {
    console.error("LEAVE ENTITLEMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch leave balances" }, 500);
  }
}

// Body: { employee_id, leave_type: code, year, days, reason }
// Overrides the leave type's default allowance for one employee and year.
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { employee_id?: unknown; leave_type?: unknown; year?: unknown; days?: unknown; reason?: unknown };
    const employeeId = typeof body.employee_id === "string" ? body.employee_id.trim() : "";
    const year = Number(body.year);
    const days = Number(body.days);
    const reason = readReason(body.reason);
    if (!employeeId || typeof body.leave_type !== "string") {
      return withCors(req, { success: false, error: "employee_id and leave_type are required" }, 400);
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return withCors(req, { success: false, error: "year is not valid" }, 400);
    if (!Number.isInteger(days) || days < 0 || days > 366) return withCors(req, { success: false, error: "days must be a whole number from 0 to 366" }, 400);
    if (!reason) return withCors(req, { success: false, error: "reason is required" }, 400);

    const type = await db`SELECT id FROM leave_types WHERE code = ${body.leave_type.trim().toLowerCase()}`;
    if (!type[0]) return withCors(req, { success: false, error: "Leave type not found" }, 404);
    const employee = await db`SELECT id FROM employees WHERE id = ${employeeId}`;
    if (!employee[0]) return withCors(req, { success: false, error: "Employee not found" }, 404);

    await runAudited(
      req,
      auth.ctx,
      { action: "timesheets.leave_entitlement.set", targetType: "employee", targetId: employeeId, reason, details: { leave_type: body.leave_type, year, days } },
      [db`
        INSERT INTO leave_entitlements (employee_id, leave_type_id, year, days, set_by)
        VALUES (${employeeId}, ${type[0].id}, ${year}, ${days}, ${auth.ctx.user.username})
        ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET days = EXCLUDED.days, set_by = EXCLUDED.set_by, updated_at = NOW()
      `]
    );

    return withCors(req, { success: true, message: "Entitlement saved", data: await leaveBalances(employeeId, year) });
  } catch (error) {
    console.error("SET LEAVE ENTITLEMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to save the entitlement" }, 500);
  }
}
