import { neon } from "@neondatabase/serverless";
import {
  type AuthContext,
  type Scope,
  can,
  covers,
  loadGrants,
  resolveScope,
  sodConflicts,
  sodKeys,
} from "@/lib/rbac";
import { normalizeScopeToBackend } from "@/lib/user-management";

const sql = neon(process.env.DATABASE_URL!);

/**
 * The rules every route that grants or removes roles must follow, so that
 * user management, bulk role changes and CSV import cannot do anything the
 * role assignment route (/api/roles) refuses:
 *
 * - nobody changes their own access
 * - the caller needs access.roles.assign, in a scope that contains the target scope
 * - roles must exist and be active
 * - roles with privileged permissions need access.privileged.grant
 * - the result must not break separation-of-duties rules
 */

const ASSIGN = "access.roles.assign";

export type CheckResult = { ok: true } | { ok: false; status: number; error: string; conflicts?: unknown };

/**
 * Validates a scope from a request (frontend names such as "assigned_mda" are
 * accepted) against the organisation tables. A scope that needs an MDA or a
 * department and does not have a valid one is an error, never a wider scope.
 */
export async function scopeFromRequest(level: unknown, mdaId: unknown, departmentId: unknown) {
  const normalised = normalizeScopeToBackend(typeof level === "string" ? level : null);
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  return resolveScope(normalised, blank(mdaId) ? null : mdaId, blank(departmentId) ? null : departmentId);
}

/** Roles by id; reports ids that do not exist or are retired. */
async function loadRoles(roleIds: number[]) {
  const rows = await sql`
    SELECT r.id, r.name, r.status, r.sod_exempt,
           COALESCE(BOOL_OR(p.is_privileged), FALSE) AS privileged,
           COALESCE(ARRAY_AGG(p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS keys
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE r.id = ANY(${roleIds})
    GROUP BY r.id
  `;
  return rows as { id: number; name: string; status: string; sod_exempt: boolean; privileged: boolean; keys: string[] }[];
}

/**
 * May the caller give `roleIds` to `targetUserId` in `scope`?
 * targetUserId is null for an account that does not exist yet.
 * With replaceExisting, the target's current roles are being replaced, so
 * only their direct permissions count towards separation of duties.
 */
export async function checkRoleAssignment(
  ctx: AuthContext,
  targetUserId: string | null,
  roleIds: number[],
  scope: Scope,
  opts: { replaceExisting?: boolean } = {}
): Promise<CheckResult> {
  if (roleIds.length === 0) return { ok: true };

  if (targetUserId !== null && targetUserId === ctx.userId) {
    return { ok: false, status: 403, error: "You cannot change your own access" };
  }
  if (!can(ctx, ASSIGN)) {
    return { ok: false, status: 403, error: "Assigning roles needs the access.roles.assign permission" };
  }
  if (!covers(ctx, ASSIGN, scope)) {
    return { ok: false, status: 403, error: "This assignment is outside your organisational scope" };
  }

  const roles = await loadRoles(roleIds);
  const missing = roleIds.filter((id) => !roles.some((r) => Number(r.id) === id));
  if (missing.length > 0) {
    return { ok: false, status: 404, error: `Role id ${missing.join(", ")} does not exist` };
  }
  const retired = roles.filter((r) => r.status !== "active");
  if (retired.length > 0) {
    return { ok: false, status: 409, error: `Retired roles cannot be assigned: ${retired.map((r) => r.name).join(", ")}` };
  }
  const privileged = roles.filter((r) => r.privileged);
  if (privileged.length > 0 && !can(ctx, "access.privileged.grant")) {
    return {
      ok: false,
      status: 403,
      error: `${privileged.map((r) => r.name).join(", ")} contains privileged permissions and needs access.privileged.grant to assign`,
    };
  }

  const current = targetUserId === null ? [] : await loadGrants(targetUserId);
  const kept = opts.replaceExisting ? current.filter((g) => g.roleId === null) : current;
  const added = roles.filter((r) => !r.sod_exempt).flatMap((r) => r.keys);
  if (added.length > 0) {
    const conflicts = await sodConflicts([...new Set([...sodKeys(kept), ...added])]);
    if (conflicts.length > 0) {
      return { ok: false, status: 409, error: "These roles together would break separation-of-duties rules", conflicts };
    }
  }
  return { ok: true };
}

/**
 * May the caller take `roleId` away from `targetUserId`? Every assignment of
 * the role must be inside the caller's scope, and privileged roles can only be
 * removed by someone who could grant them.
 */
export async function checkRoleRevocation(ctx: AuthContext, targetUserId: string, roleId: number): Promise<CheckResult> {
  if (targetUserId === ctx.userId) {
    return { ok: false, status: 403, error: "You cannot change your own access" };
  }
  if (!can(ctx, ASSIGN)) {
    return { ok: false, status: 403, error: "Removing roles needs the access.roles.assign permission" };
  }

  const assignments = await sql`
    SELECT scope_level, company_id, department_id FROM user_roles WHERE user_id = ${targetUserId} AND role_id = ${roleId}
  `;
  for (const a of assignments) {
    const scope: Scope = {
      level: a.scope_level,
      companyId: a.company_id == null ? null : Number(a.company_id),
      departmentId: a.department_id == null ? null : Number(a.department_id),
    };
    if (!covers(ctx, ASSIGN, scope)) {
      return { ok: false, status: 403, error: "This user holds the role outside your organisational scope" };
    }
  }

  const [role] = await loadRoles([roleId]);
  if (role?.privileged && !can(ctx, "access.privileged.grant")) {
    return { ok: false, status: 403, error: `${role.name} contains privileged permissions and needs access.privileged.grant to remove` };
  }
  return { ok: true };
}
