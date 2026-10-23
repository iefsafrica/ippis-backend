import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";
import { runAudited, type AuthContext } from "@/lib/rbac";
import { recordScope, inScope } from "@/lib/mda-scope";
import { notify } from "@/lib/employee-notifications";
import { todayLagos } from "@/lib/employee-time";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Transfers that move people (ORG-05).
 *
 * A transfer names where the employee goes by id: MDA, department, designation
 * and location. Completing it moves the employee and reassesses the access of
 * any admin account they hold (admin_users.staff_id = employees.id):
 *   - moving to another MDA removes role and permission grants scoped to the
 *     MDA they left, or to any of its departments
 *   - moving department inside the MDA removes grants scoped to the department
 *     they left
 *   - grants across all MDAs are kept but listed for review, since they come
 *     with central posts the transfer may or may not change
 * The account then belongs to the new MDA and department and its sessions end,
 * so the person signs in again with only the access they still hold. New access
 * at the destination is granted the usual way.
 */

export const APPROVE = "corehr.records.approve";

export type Unit = {
  companyId: number | null;
  departmentId: number | null;
  designationId: number | null;
  locationId: number | null;
};

export type Destination = Unit & {
  companyId: number;
  companyName: string;
  departmentName: string | null;
  designationTitle: string | null;
  locationName: string | null;
};

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

/** Whether the body names a destination at all. */
export function namesDestination(body: Record<string, unknown>) {
  return ["to_company_id", "to_mda_id", "to_department_id", "to_designation_id", "to_location_id"].some(
    (k) => body[k] !== undefined && body[k] !== null && body[k] !== ""
  );
}

/**
 * Checks the destination in a request body. An MDA left out means the MDA of
 * the department named, or else the employee's current MDA. Every unit named
 * must belong to that MDA, and the MDA must be active.
 */
export async function resolveDestination(
  body: Record<string, unknown>,
  current: Unit
): Promise<{ ok: true; destination: Destination } | { ok: false; error: string }> {
  const ids = {
    company: num(body.to_company_id ?? body.to_mda_id),
    department: num(body.to_department_id),
    designation: num(body.to_designation_id),
    location: num(body.to_location_id),
  };
  for (const [name, v] of Object.entries(ids)) {
    if (v !== null && (!Number.isInteger(v) || v <= 0)) return { ok: false, error: `to_${name}_id is not valid` };
  }

  let department: any = null;
  if (ids.department !== null) {
    [department] = await sql`SELECT id, name, company_id FROM departments WHERE id = ${ids.department}`;
    if (!department) return { ok: false, error: "Destination department not found" };
  }
  const companyId = ids.company ?? (department ? Number(department.company_id) : current.companyId);
  if (companyId === null) return { ok: false, error: "to_company_id (the destination MDA) is required" };
  if (department && Number(department.company_id) !== companyId) {
    return { ok: false, error: "The destination department does not belong to the destination MDA" };
  }

  const [company] = await sql`SELECT id, name, status FROM companies WHERE id = ${companyId}`;
  if (!company || String(company.status ?? "active").toLowerCase() !== "active") {
    return { ok: false, error: "The destination must be an active MDA" };
  }

  let designation: any = null;
  if (ids.designation !== null) {
    [designation] = await sql`SELECT id, title FROM designations WHERE id = ${ids.designation} AND company_id = ${companyId}`;
    if (!designation) return { ok: false, error: "The destination designation does not belong to the destination MDA" };
  }
  let location: any = null;
  if (ids.location !== null) {
    [location] = await sql`SELECT id, name FROM locations WHERE id = ${ids.location} AND company_id = ${companyId}`;
    if (!location) return { ok: false, error: "The destination location does not belong to the destination MDA" };
  }

  // Inside the same MDA, a unit left out stays as it is; in another MDA it is cleared
  const sameMda = companyId === current.companyId;
  return {
    ok: true,
    destination: {
      companyId,
      companyName: String(company.name),
      departmentId: department ? Number(department.id) : sameMda ? current.departmentId : null,
      departmentName: department ? String(department.name) : null,
      designationId: designation ? Number(designation.id) : sameMda ? current.designationId : null,
      designationTitle: designation ? String(designation.title) : null,
      locationId: location ? Number(location.id) : sameMda ? current.locationId : null,
      locationName: location ? String(location.name) : null,
    },
  };
}

export function unitOf(row: any, prefix = ""): Unit {
  return {
    companyId: num(row[`${prefix}company_id`]),
    departmentId: num(row[`${prefix}department_id`]),
    designationId: num(row[`${prefix}designation_id`]),
    locationId: num(row[`${prefix}location_id`]),
  };
}

/** Deciding a transfer needs authority over both where the employee is and where they are going. */
export function coversBothEnds(ctx: AuthContext, key: string, from: Unit, to: Unit) {
  const sc = recordScope(ctx, key);
  return inScope(sc, from.companyId, from.departmentId) && inScope(sc, to.companyId, to.departmentId);
}

/** Seeing or declining a transfer needs authority over either end. */
export function coversEitherEnd(ctx: AuthContext, key: string, from: Unit, to: Unit | null) {
  const sc = recordScope(ctx, key);
  return inScope(sc, from.companyId, from.departmentId) || (!!to && inScope(sc, to.companyId, to.departmentId));
}

/** A transfer with the employee's current place, by transfer id. */
export async function loadTransfer(id: number) {
  const [row] = await sql`
    SELECT t.*, t.effective_date::text AS effective_date,
           e.company_id, e.department_id, e.designation_id, e.location_id,
           e.name AS current_name, e.status AS employee_status, e.department AS current_department, e.position AS current_position
    FROM employee_transfers t
    JOIN employees e ON e.id = t.employee_id
    WHERE t.id = ${id}
  `;
  return row ?? null;
}

type GrantRow = {
  kind: "role" | "permission";
  id: string | null;
  user_id: string;
  username: string;
  grant: string;
  scope_level: string;
  company_id: number | null;
  department_id: number | null;
};

export type AccessChanges = {
  accounts: { id: number; username: string }[];
  removed: GrantRow[];
  review: GrantRow[];
  sessions_ended: boolean;
};

/** What happens to the access of the employee's admin accounts when they move from one unit to another. */
export async function reassessAccess(employeeId: string, from: Unit, to: Unit): Promise<AccessChanges> {
  const accounts = await sql`SELECT id, username FROM admin_users WHERE TRIM(staff_id) = ${employeeId}`;
  if (accounts.length === 0) return { accounts: [], removed: [], review: [], sessions_ended: false };
  const userIds = accounts.map((a: any) => String(a.id));

  const grants = (await sql`
    SELECT 'role' AS kind, ur.id::text AS id, ur.user_id, u.username, r.key AS grant,
           ur.scope_level, ur.company_id, ur.department_id
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN admin_users u ON u.id::text = ur.user_id
    WHERE ur.user_id = ANY(${userIds}) AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    UNION ALL
    SELECT 'permission', NULL, up.user_id, u.username, p.key,
           up.scope_level, up.company_id, up.department_id
    FROM user_permissions up JOIN permissions p ON p.id = up.permission_id JOIN admin_users u ON u.id::text = up.user_id
    WHERE up.user_id = ANY(${userIds}) AND (up.expires_at IS NULL OR up.expires_at > NOW())
  `) as GrantRow[];

  const leftMda = from.companyId !== null && from.companyId !== to.companyId;
  const leftDepartment = from.departmentId !== null && from.departmentId !== to.departmentId;
  const removed: GrantRow[] = [];
  const review: GrantRow[] = [];
  for (const g of grants) {
    const company = g.company_id === null ? null : Number(g.company_id);
    const department = g.department_id === null ? null : Number(g.department_id);
    if (g.scope_level === "global") review.push(g);
    else if (leftMda && company === from.companyId) removed.push(g);
    else if (!leftMda && leftDepartment && g.scope_level === "department" && department === from.departmentId) removed.push(g);
  }
  return {
    accounts: accounts.map((a: any) => ({ id: Number(a.id), username: String(a.username) })),
    removed,
    review,
    sessions_ended: true,
  };
}

/**
 * Moves the employee and applies the access changes, in one audited
 * transaction. Only a transfer still in `expectFrom` status is completed, so
 * two people completing it at once cannot both succeed.
 */
export async function completeTransfer(
  req: NextRequest,
  ctx: AuthContext,
  transfer: any,
  expectFrom: "pending" | "approved",
  approvalReason: string | null
): Promise<{ ok: true; access: AccessChanges } | { ok: false; status: number; error: string }> {
  const from = unitOf(transfer);
  const to = unitOf(transfer, "to_");
  if (to.companyId === null) return { ok: false, status: 400, error: "Set the destination (to_company_id or to_department_id) before approving" };

  const [names] = await sql`
    SELECT d.name AS department_name, des.title AS designation_title
    FROM (SELECT 1) x
    LEFT JOIN departments d ON d.id = ${to.departmentId}
    LEFT JOIN designations des ON des.id = ${to.designationId}
  `;
  const access = await reassessAccess(String(transfer.employee_id), from, to);
  const by = ctx.user.username;
  const id = Number(transfer.id);
  const removedRoles = access.removed.filter((g) => g.kind === "role").map((g) => g.id!);
  const removedPermissions = JSON.stringify(
    access.removed.filter((g) => g.kind === "permission").map((g) => ({ user_id: g.user_id, key: g.grant, scope_level: g.scope_level, company_id: g.company_id, department_id: g.department_id }))
  );
  const accountIds = access.accounts.map((a) => a.id);

  const statements: Parameters<typeof runAudited>[3] = [
    // Claims the transfer first; the guard below aborts everything if someone else did
    sql`
      UPDATE employee_transfers
      SET status = 'completed', completed_by = ${by}, completed_at = NOW(),
          approved_by = COALESCE(approved_by, ${by}), approved_at = COALESCE(approved_at, NOW()),
          from_company_id = COALESCE(from_company_id, ${from.companyId}), from_department_id = COALESCE(from_department_id, ${from.departmentId}),
          from_designation_id = COALESCE(from_designation_id, ${from.designationId}), from_location_id = COALESCE(from_location_id, ${from.locationId}),
          access_changes = ${JSON.stringify(access)}::jsonb, updated_at = NOW()
      WHERE id = ${id} AND status = ${expectFrom}
    `,
    sql`
      SELECT 1 / (SELECT COUNT(*)::int FROM employee_transfers
                  WHERE id = ${id} AND status = 'completed' AND completed_at = NOW()) AS claimed
    `,
    sql`
      UPDATE employees
      SET company_id = ${to.companyId}, department_id = ${to.departmentId},
          designation_id = ${to.designationId}, location_id = ${to.locationId},
          department = COALESCE(${names?.department_name ?? null}, CASE WHEN ${to.companyId}::int IS DISTINCT FROM company_id THEN NULL ELSE department END),
          position = COALESCE(${transfer.to_position ?? null}, ${names?.designation_title ?? null}, position),
          mda_linked_at = NOW(), mda_linked_by = ${by}, updated_at = NOW()
      WHERE id = ${transfer.employee_id}
    `,
    sql`DELETE FROM user_roles WHERE id = ANY(${removedRoles}::bigint[])`,
    sql`
      DELETE FROM user_permissions up
      USING permissions p, jsonb_to_recordset(${removedPermissions}::jsonb)
            AS x(user_id text, key text, scope_level text, company_id int, department_id int)
      WHERE p.id = up.permission_id AND p.key = x.key AND up.user_id = x.user_id
        AND up.scope_level = x.scope_level
        AND up.company_id IS NOT DISTINCT FROM x.company_id
        AND up.department_id IS NOT DISTINCT FROM x.department_id
    `,
    // The account now belongs to the new unit, and its sessions end
    sql`
      UPDATE admin_users
      SET mda_id = ${to.companyId}, department_id = ${to.departmentId}, sessions_valid_after = NOW(), updated_at = NOW()
      WHERE id = ANY(${accountIds}::int[])
    `,
  ];

  try {
    await runAudited(
      req,
      ctx,
      {
        action: "corehr.transfer.completed",
        targetType: "employee",
        targetId: String(transfer.employee_id),
        reason: approvalReason,
        details: {
          transfer_id: id,
          from,
          to,
          access_removed: access.removed.map((g) => `${g.username}: ${g.kind} ${g.grant} (${g.scope_level})`),
          access_to_review: access.review.map((g) => `${g.username}: ${g.kind} ${g.grant} (global)`),
        },
      },
      statements
    );
  } catch (error: any) {
    if (error?.code === "22012") return { ok: false, status: 409, error: "This transfer was decided by someone else" };
    if (error?.code === "23503" || error?.code === "23514") {
      return { ok: false, status: 409, error: "The destination is no longer valid; update the transfer" };
    }
    throw error;
  }

  await notify(String(transfer.employee_id), "profile", {
    title: "Transfer completed",
    message: `Your transfer${names?.department_name ? ` to ${names.department_name}` : ""} took effect on ${transfer.effective_date}.`,
    link: "/employee/profile",
  });
  return { ok: true, access };
}

export function isDue(transfer: { effective_date?: unknown }) {
  return String(transfer.effective_date).slice(0, 10) <= todayLagos();
}
