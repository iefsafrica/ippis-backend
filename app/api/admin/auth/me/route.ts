import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate, permissionKeys, scopeOf } from "@/lib/rbac";

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

    const roles = await db`
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
    `;

    const keys = permissionKeys(ctx);
    const modules = [...new Set(keys.map((key) => key.split(".")[0] ?? key))];

    return withCors(req, {
      success: true,
      data: {
        user: ctx.user,
        roles,
        modules,
        permissions: keys.map((key) => ({ key, scope: scopeOf(ctx, key) })),
      },
    });
  } catch (error: any) {
    console.error("AUTH ME ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to load profile" }, 500);
  }
}
