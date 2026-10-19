import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, loadGrants } from "@/lib/rbac";
import {
  computeDetailedModuleAccess,
  formatUserAccount,
  loadUserRolesMap,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);
const VIEW = "users.accounts.view";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || searchParams.get("user_id");

    if (!id) {
      return withCors(req, { success: false, error: "User id is required" }, 400);
    }

    const rows = await db`
      SELECT u.id, u.username, u.email, u.full_name, u.staff_id, u.phone,
             u.role, u.is_active, u.status, u.mda_id, u.department_id,
             u.scope_level, u.notes, u.last_login, u.created_at, u.updated_at,
             c.name AS mda_name, d.name AS department_name
      FROM admin_users u
      LEFT JOIN companies c ON c.id = u.mda_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ${id}
    `;

    if (!rows[0]) {
      return withCors(req, { success: false, error: "User not found" }, 404);
    }

    const allRoles = await db`SELECT id, name, description, key FROM roles WHERE status = 'active'`;
    const rolesMap = await loadUserRolesMap([rows[0].id]);
    const userRoles = rolesMap[String(rows[0].id)] || [];
    const formattedUser = formatUserAccount(rows[0], userRoles, allRoles.map(r => ({ id: Number(r.id), name: String(r.name) })));

    // Load detailed modules
    const modules = computeDetailedModuleAccess(userRoles);

    // Load granular permissions held by this user
    const perms = await db`
      SELECT p.id, p.name, p.resource, p.action, p.description, p.key, p.is_privileged
      FROM permissions p
      WHERE p.id IN (
        SELECT up.permission_id
        FROM user_permissions up
        WHERE up.user_id = ${id}
          AND (up.expires_at IS NULL OR up.expires_at > NOW())

        UNION

        SELECT rp.permission_id
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id AND r.status = 'active'
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ${id}
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      )
      ORDER BY p.resource ASC, p.action ASC
    `;

    // Map permissions
    const granularPermissions = perms.map((p) => ({
      id: Number(p.id),
      name: String(p.name || p.key),
      resource: String(p.resource),
      action: String(p.action),
      description: p.description ? String(p.description) : "",
      key: p.key ? String(p.key) : undefined,
      is_privileged: Boolean(p.is_privileged),
    }));

    // If super admin and no direct/role perms mapped yet in DB, supply universal description
    const isSuper = formattedUser.roles.some((r) =>
      r.name.toLowerCase().includes("super") || (r.key && r.key.includes("super"))
    );
    if (isSuper && granularPermissions.length === 0) {
      granularPermissions.push({
        id: 1,
        name: "All Operations",
        resource: "*",
        action: "manage",
        description: "Superadministrator unrestricted privilege",
        key: "*",
        is_privileged: true,
      });
    }

    return withCors(req, {
      success: true,
      data: {
        user: formattedUser,
        modules,
        granular_permissions: granularPermissions,
      },
    });
  } catch (error: any) {
    console.error("GET EFFECTIVE ACCESS ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to load effective access" }, 500);
  }
}
