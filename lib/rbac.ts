import { neon, type NeonQueryPromise } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { withCors } from "@/lib/cors";
import { clientIp } from "@/lib/rate-limit";

const sql = neon(process.env.DATABASE_URL!);

/**
 * =========================
 * TYPES
 * =========================
 */

export type ScopeLevel = "global" | "mda" | "department" | "self";

// MDA = companies.id, department = departments.id
export type Scope = {
  level: ScopeLevel;
  companyId: number | null;
  departmentId: number | null;
};

export type Grant = Scope & {
  key: string;
  privileged: boolean;
  roleId: number | null; // null = granted directly to the user
  sodExempt: boolean;
};

export type AuthContext = {
  user: { id: number; username: string; email: string; fullName: string };
  userId: string; // as stored in user_roles / user_permissions
  grants: Grant[];
};

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse };

export type PermissionScope = {
  global: boolean;
  companyIds: number[];
  departmentIds: number[];
  self: boolean;
};

export type AuditEntry = {
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  reason?: string | null;
  details?: Record<string, unknown>;
};

type Statement = NeonQueryPromise<false, false>;

const SCOPE_LEVELS: ScopeLevel[] = ["global", "mda", "department", "self"];

/**
 * =========================
 * AUTHENTICATION
 * =========================
 */

function deny(req: NextRequest, status: number, error: string, extra: Record<string, unknown> = {}) {
  return withCors(req, { success: false, error, ...extra }, status);
}

export function readToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return req.cookies.get("token")?.value || null;
}

// A grant whose scope cannot be evaluated is dropped, which denies access.
function toScope(level: unknown, companyId: unknown, departmentId: unknown): Scope | null {
  const company = companyId == null ? null : Number(companyId);
  const department = departmentId == null ? null : Number(departmentId);

  if (level === "global" || level === "self") {
    return { level, companyId: null, departmentId: null };
  }
  if (level === "mda" && company != null && Number.isInteger(company)) {
    return { level, companyId: company, departmentId: null };
  }
  if (
    level === "department" &&
    company != null && Number.isInteger(company) &&
    department != null && Number.isInteger(department)
  ) {
    return { level, companyId: company, departmentId: department };
  }
  return null;
}

/**
 * Effective grants for a user: permissions from active, unexpired role
 * assignments plus permissions granted directly.
 */
export async function loadGrants(userId: string): Promise<Grant[]> {
  const rows = await sql`
    SELECT p.key, p.is_privileged, ur.scope_level, ur.company_id, ur.department_id,
           r.id AS role_id, r.sod_exempt
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id AND p.key IS NOT NULL
    WHERE ur.user_id = ${userId}
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())

    UNION ALL

    SELECT p.key, p.is_privileged, up.scope_level, up.company_id, up.department_id,
           NULL::int AS role_id, FALSE AS sod_exempt
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id AND p.key IS NOT NULL
    WHERE up.user_id = ${userId}
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
  `;

  const grants: Grant[] = [];
  for (const row of rows) {
    const scope = toScope(row.scope_level, row.company_id, row.department_id);
    if (!scope) continue;
    grants.push({
      ...scope,
      key: String(row.key),
      privileged: Boolean(row.is_privileged),
      roleId: row.role_id == null ? null : Number(row.role_id),
      sodExempt: Boolean(row.sod_exempt),
    });
  }
  return grants;
}

/**
 * Verifies the JWT issued by /api/admin/auth/login/verify-otp, confirms the
 * account is still active and its sessions have not been revoked, and loads
 * the user's effective grants.
 */
export async function authenticate(req: NextRequest): Promise<AuthResult> {
  const token = readToken(req);
  if (!token) {
    return { ok: false, response: deny(req, 401, "Authentication required") };
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("RBAC ERROR: JWT_SECRET is not set");
    return { ok: false, response: deny(req, 500, "Server authentication is not configured") };
  }

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") throw new Error("Unexpected token payload");
    payload = decoded;
  } catch {
    return { ok: false, response: deny(req, 401, "Invalid or expired token") };
  }

  // Employee portal tokens are signed with the same secret but never grant admin access
  if (payload.typ === "employee") {
    return { ok: false, response: deny(req, 401, "Invalid or expired token") };
  }

  const id = Number(payload.id);
  if (!Number.isInteger(id)) {
    return { ok: false, response: deny(req, 401, "Invalid or expired token") };
  }

  try {
    const [users, grants] = await Promise.all([
      sql`
        SELECT id, username, email, full_name, is_active, status,
               EXTRACT(EPOCH FROM sessions_valid_after)::float8 AS valid_after
        FROM admin_users
        WHERE id = ${id}
      `,
      loadGrants(String(id)),
    ]);

    const user = users[0];
    if (!user || !user.is_active || user.status !== "active") {
      return { ok: false, response: deny(req, 401, "Account is not active") };
    }

    if (user.valid_after != null && (payload.iat ?? 0) <= Math.floor(Number(user.valid_after))) {
      return { ok: false, response: deny(req, 401, "Session has been revoked. Please sign in again.") };
    }

    return {
      ok: true,
      ctx: {
        user: {
          id,
          username: String(user.username),
          email: String(user.email),
          fullName: String(user.full_name),
        },
        userId: String(id),
        grants,
      },
    };
  } catch (error) {
    // Deny rather than guess when access cannot be evaluated
    console.error("RBAC ERROR: could not evaluate access:", error);
    return { ok: false, response: deny(req, 503, "Access control is unavailable") };
  }
}

/**
 * Route guard. Usage:
 *
 *   const auth = await requirePermission(req, "employees.records.view");
 *   if (!auth.ok) return auth.response;
 *
 * A self-scoped grant ("own records") is refused unless the route passes
 * { allowSelf: true } and then limits the data to the caller's own records.
 */
export async function requirePermission(
  req: NextRequest,
  key: string,
  options: { allowSelf?: boolean } = {}
): Promise<AuthResult> {
  const auth = await authenticate(req);
  if (!auth.ok) return auth;

  const allowed = options.allowSelf ? holds(auth.ctx, key) : can(auth.ctx, key);
  if (!allowed) {
    return {
      ok: false,
      response: deny(req, 403, "You do not have permission to perform this action", { required: key }),
    };
  }
  return auth;
}

/**
 * =========================
 * PERMISSION + SCOPE CHECKS
 * =========================
 */

/** Holds the permission in an organisational scope (global, MDA or department). */
export function can(ctx: AuthContext, key: string): boolean {
  return ctx.grants.some((g) => g.key === key && g.level !== "self");
}

/** Holds the permission in any scope, including own records only. */
export function holds(ctx: AuthContext, key: string): boolean {
  return ctx.grants.some((g) => g.key === key);
}

export function permissionKeys(ctx: AuthContext): string[] {
  return [...new Set(ctx.grants.map((g) => g.key))].sort();
}

/** Where the user may use a permission. Routes filter their data by this. */
export function scopeOf(ctx: AuthContext, key: string): PermissionScope {
  const scope: PermissionScope = { global: false, companyIds: [], departmentIds: [], self: false };

  for (const g of ctx.grants) {
    if (g.key !== key) continue;
    if (g.level === "global") scope.global = true;
    if (g.level === "self") scope.self = true;
    if (g.level === "mda" && g.companyId != null && !scope.companyIds.includes(g.companyId)) {
      scope.companyIds.push(g.companyId);
    }
    if (g.level === "department" && g.departmentId != null && !scope.departmentIds.includes(g.departmentId)) {
      scope.departmentIds.push(g.departmentId);
    }
  }
  return scope;
}

/**
 * True when the user holds `key` in a scope that contains `target`.
 * A department grant never reaches another department or its MDA.
 */
export function covers(ctx: AuthContext, key: string, target: Scope): boolean {
  return ctx.grants.some((g) => {
    if (g.key !== key || g.level === "self") return false;
    if (g.level === "global") return true;
    if (target.level === "global") return false;
    if (target.level === "self") return true;
    if (g.level === "mda") return target.companyId === g.companyId;
    return target.level === "department" && target.departmentId === g.departmentId;
  });
}

/** Validates a requested scope against the organisation tables. */
export async function resolveScope(
  level: unknown,
  companyId: unknown,
  departmentId: unknown
): Promise<{ scope: Scope } | { error: string }> {
  if (typeof level !== "string" || !SCOPE_LEVELS.includes(level as ScopeLevel)) {
    return { error: "scope_level must be one of: global, mda, department, self" };
  }

  if (level === "global" || level === "self") {
    return { scope: { level, companyId: null, departmentId: null } };
  }

  if (level === "mda") {
    const id = Number(companyId);
    if (companyId == null || !Number.isInteger(id)) {
      return { error: "company_id is required for mda scope" };
    }
    const company = await sql`SELECT id FROM companies WHERE id = ${id}`;
    if (!company[0]) return { error: "Company (MDA) not found" };
    return { scope: { level, companyId: id, departmentId: null } };
  }

  const id = Number(departmentId);
  if (departmentId == null || !Number.isInteger(id)) {
    return { error: "department_id is required for department scope" };
  }
  const department = await sql`SELECT id, company_id FROM departments WHERE id = ${id}`;
  if (!department[0]) return { error: "Department not found" };

  const owner = Number(department[0].company_id);
  if (companyId != null && Number(companyId) !== owner) {
    return { error: "Department does not belong to the given company (MDA)" };
  }
  return { scope: { level: "department", companyId: owner, departmentId: id } };
}

/**
 * =========================
 * SEPARATION OF DUTIES
 * =========================
 */

/** Rules broken when one user holds every permission in `keys`. */
export async function sodConflicts(keys: string[]) {
  if (keys.length < 2) return [];
  return sql`
    SELECT permission_a, permission_b, description
    FROM sod_rules
    WHERE permission_a = ANY(${keys}) AND permission_b = ANY(${keys})
  `;
}

/** Permission keys that count towards separation of duties for a user. */
export function sodKeys(grants: Grant[]): string[] {
  return [...new Set(grants.filter((g) => !g.sodExempt).map((g) => g.key))];
}

/**
 * =========================
 * AUDIT
 * =========================
 */

export function auditStatement(req: NextRequest, ctx: AuthContext, entry: AuditEntry): Statement {
  const ip = clientIp(req) === "unknown" ? null : clientIp(req);

  return sql`
    INSERT INTO audit_logs (actor_id, actor_username, action, target_type, target_id, reason, details, ip_address)
    VALUES (
      ${ctx.userId},
      ${ctx.user.username},
      ${entry.action},
      ${entry.targetType ?? null},
      ${entry.targetId == null ? null : String(entry.targetId)},
      ${entry.reason ?? null},
      ${JSON.stringify(entry.details ?? {})}::jsonb,
      ${ip}
    )
  `;
}

/**
 * Runs the statements and the audit record in one transaction, so a sensitive
 * change is never stored without its audit event.
 */
export function runAudited(req: NextRequest, ctx: AuthContext, entry: AuditEntry, statements: Statement[]) {
  return sql.transaction([...statements, auditStatement(req, ctx, entry)]);
}

export function readReason(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
