import { neon } from "@neondatabase/serverless";
import { can, type AuthContext } from "@/lib/rbac";
import { employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Approvals record the signed-in user, never a name sent in the request, and
 * follow the permission catalogue: recording a request needs the "manage"
 * permission, deciding it needs "approve" over that employee, and nobody
 * decides a request about themselves.
 */

export const LEAVE_MANAGE = "timesheets.leaves.manage";
export const LEAVE_APPROVE = "timesheets.leaves.approve";

const DECISIONS = ["approved", "rejected"];

/** The status, normalised, when it is a decision (approved or rejected); otherwise null. */
export function decisionOf(status: unknown): "approved" | "rejected" | null {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return DECISIONS.includes(s) ? (s as "approved" | "rejected") : null;
}

/** The employee record of the signed-in admin, linked by staff ID. */
export async function ownEmployeeId(ctx: AuthContext): Promise<string | null> {
  const [row] = await sql`SELECT NULLIF(TRIM(staff_id), '') AS staff_id FROM admin_users WHERE id = ${ctx.user.id}`;
  return row?.staff_id ?? null;
}

/** Why the caller may not decide a request about this employee, or null when they may. */
export async function decisionRefusal(
  ctx: AuthContext,
  key: string,
  employeeId: unknown
): Promise<{ status: number; error: string } | null> {
  if (!can(ctx, key)) return { status: 403, error: `Approving or rejecting needs the ${key} permission` };
  if (!(await employeeInScope(ctx, key, employeeId))) return { status: 404, error: OUT_OF_SCOPE };
  if ((await ownEmployeeId(ctx)) === String(employeeId)) {
    return { status: 403, error: "You cannot decide a request about yourself; another approver must" };
  }
  return null;
}

/**
 * Stores who decided a leave request and when. Needs the decided_by and
 * decided_at columns (database/mda-completion-migration.sql); without them the
 * decision is still in the audit log.
 */
export async function recordLeaveDecision(table: "leaves" | "employee_leaves", id: unknown, by: string) {
  try {
    if (table === "leaves") await sql`UPDATE leaves SET decided_by = ${by}, decided_at = NOW() WHERE id::text = ${String(id)}`;
    else await sql`UPDATE employee_leaves SET decided_by = ${by}, decided_at = NOW() WHERE id::text = ${String(id)}`;
  } catch (error: any) {
    if (error?.code !== "42703") throw error;
  }
}
