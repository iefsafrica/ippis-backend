import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate, permissionKeys, scopeOf } from "@/lib/rbac";

import { computeAccessibleModules, UserRoleRecord } from "@/lib/user-management";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * The signed-in user with their effective roles, permissions and modules.
 * The frontend builds its navigation and dashboard from this; hiding a menu
 * item grants nothing, every route still checks the permission itself.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const [rolesResult, userRows] = await Promise.all([
      db`
        SELECT r.id, r.key, r.name, ur.scope_level,
               ur.company_id, c.name AS company_name,
               ur.department_id, d.name AS department_name,
               ur.expires_at
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
        LEFT JOIN companies c ON c.id = ur.company_id
        LEFT JOIN departments d ON d.id = ur.department_id
        WHERE ur.user_id = ${ctx.userId}
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY r.name ASC
      `,
      db`
        SELECT u.id, u.username, u.email, u.full_name, u.role, u.status, u.is_active,
               u.mda_id, u.department_id, u.scope_level,
               c.name AS company_name, d.name AS department_name
        FROM admin_users u
        LEFT JOIN companies c ON c.id = u.mda_id
        LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = ${ctx.user.id}
        LIMIT 1
      `,
    ]);

    let roles: UserRoleRecord[] = rolesResult.map((r: any) => ({
      id: Number(r.id),
      key: r.key ? String(r.key) : null,
      name: String(r.name),
      scope_level: r.scope_level ? String(r.scope_level) : null,
      company_id: r.company_id != null ? Number(r.company_id) : null,
      department_id: r.department_id != null ? Number(r.department_id) : null,
      company_name: r.company_name ? String(r.company_name) : null,
      department_name: r.department_name ? String(r.department_name) : null,
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : undefined,
    }));

    const dbUser = userRows[0];

    // Fallback if no user_roles assigned: deduce from legacy admin_users.role
    if (roles.length === 0 && dbUser?.role) {
      const legacy = String(dbUser.role).toLowerCase();
      if (legacy.includes("super")) {
        roles = [{ id: 4, name: "Super Administrator", key: "super_admin", scope_level: "global" }];
      } else if (legacy === "admin") {
        roles = [{ id: 8, name: "MDA Administrator", key: "mda_admin", scope_level: "mda" }];
      } else if (legacy === "viewer") {
        roles = [{ id: 13, name: "Internal Auditor", key: "internal_auditor", scope_level: "global" }];
      } else {
        roles = [{ id: 1, name: String(dbUser.role), key: legacy, scope_level: "mda" }];
      }
    }

    const primaryRole = roles[0];
    const primaryRoleName = primaryRole?.name || (dbUser?.role === "superadmin" ? "Super Administrator" : "Administrator");
    const primaryRoleKey = primaryRole?.key || (dbUser?.role || "admin");

    const keys = permissionKeys(ctx);
    const accessibleModules = computeAccessibleModules(roles, keys);

    // Legacy resource prefix modules for backwards compatibility with tests
    const rawPrefixes = keys.map((key) => key.split(".")[0] ?? key);
    const combinedModules = Array.from(new Set([...accessibleModules, ...rawPrefixes]));

    const enrichedUser = {
      id: ctx.user.id,
      username: ctx.user.username,
      email: ctx.user.email,
      fullName: ctx.user.fullName || dbUser?.full_name || ctx.user.username,
      role: primaryRoleName,
      role_key: primaryRoleKey,
      status: dbUser?.status || (dbUser?.is_active ? "active" : "deactivated"),
      mda_id: primaryRole?.company_id ?? (dbUser?.mda_id != null ? Number(dbUser.mda_id) : null),
      company_name: primaryRole?.company_name || dbUser?.company_name || "",
      department_id: primaryRole?.department_id ?? (dbUser?.department_id != null ? Number(dbUser.department_id) : null),
      department_name: primaryRole?.department_name || dbUser?.department_name || "",
      scope_level: primaryRole?.scope_level || dbUser?.scope_level || "assigned_mda",
      accessible_modules: accessibleModules,
    };

    return withCors(req, {
      success: true,
      data: {
        user: enrichedUser,
        roles,
        primary_role: primaryRole || null,
        modules: combinedModules,
        accessible_modules: accessibleModules,
        permissions: keys.map((key) => ({ key, scope: scopeOf(ctx, key) })),
      },
    });
  } catch (error: any) {
    console.error("AUTH ME ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to load profile" }, 500);
  }
}
