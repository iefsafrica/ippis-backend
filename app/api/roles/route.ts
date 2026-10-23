import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import {
  authenticate,
  requirePermission,
  can,
  covers,
  resolveScope,
  loadGrants,
  sodConflicts,
  sodKeys,
  runAudited,
  readReason,
  type AuthContext,
  type Scope,
} from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// user_roles.user_id holds an admin_users id, or (legacy) an employee registration id
async function subjectExists(userId: string): Promise<boolean> {
  if (/^\d+$/.test(userId)) {
    const admin = await db`SELECT id FROM admin_users WHERE id = ${Number(userId)}`;
    if (admin.length > 0) return true;
  }
  const emp = await db`SELECT registration_id FROM employees WHERE registration_id = ${userId}`;
  if (emp.length > 0) return true;
  const reg = await db`SELECT registration_id FROM registrations WHERE registration_id = ${userId}`;
  return reg.length > 0;
}

function rowScope(row: Record<string, any>): Scope {
  return {
    level: row.scope_level,
    companyId: row.company_id == null ? null : Number(row.company_id),
    departmentId: row.department_id == null ? null : Number(row.department_id),
  };
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---------------- ASSIGN ROLE ----------------
async function assignRole(req: NextRequest, ctx: AuthContext, body: any) {
  const userId = body.user_id == null ? "" : String(body.user_id).trim();
  const roleId = Number(body.role_id);
  const reason = readReason(body.reason);

  if (!userId || !Number.isInteger(roleId)) {
    return withCors(req, { success: false, error: "user_id and role_id are required" }, 400);
  }
  if (!reason) {
    return withCors(req, { success: false, error: "reason is required" }, 400);
  }
  if (userId === ctx.userId) {
    return withCors(req, { success: false, error: "You cannot change your own access" }, 403);
  }

  const roleRows = await db`SELECT id, name, status, default_scope, sod_exempt FROM roles WHERE id = ${roleId}`;
  const role = roleRows[0];
  if (!role) {
    return withCors(req, { success: false, error: "Role ID does not exist" }, 404);
  }
  if (role.status !== "active") {
    return withCors(req, { success: false, error: "Role is retired and cannot be assigned" }, 409);
  }

  if (!(await subjectExists(userId))) {
    return withCors(req, { success: false, error: "User ID does not exist" }, 404);
  }

  const resolved = await resolveScope(body.scope_level ?? role.default_scope, body.company_id, body.department_id);
  if ("error" in resolved) {
    return withCors(req, { success: false, error: resolved.error }, 400);
  }
  const scope = resolved.scope;

  if (!covers(ctx, "access.roles.assign", scope)) {
    return withCors(req, { success: false, error: "This assignment is outside your organisational scope" }, 403);
  }

  let expiresAt: string | null = null;
  if (body.expires_at != null && body.expires_at !== "") {
    const date = new Date(body.expires_at);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      return withCors(req, { success: false, error: "expires_at must be a future date" }, 400);
    }
    expiresAt = date.toISOString();
  }

  const rolePerms = await db`
    SELECT p.key, p.is_privileged
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id AND p.key IS NOT NULL
    WHERE rp.role_id = ${roleId}
  `;

  if (rolePerms.some((p) => p.is_privileged) && !can(ctx, "access.privileged.grant")) {
    return withCors(req, {
      success: false,
      error: "This role contains privileged permissions and needs access.privileged.grant to assign",
    }, 403);
  }

  if (!role.sod_exempt) {
    const held = sodKeys(await loadGrants(userId));
    const combined = [...new Set([...held, ...rolePerms.map((p) => String(p.key))])];
    const conflicts = await sodConflicts(combined);
    if (conflicts.length > 0) {
      return withCors(req, {
        success: false,
        error: "Assignment would break separation-of-duties rules",
        conflicts,
      }, 409);
    }
  }

  // Replace an existing assignment in the same scope, then insert
  try {
    await runAudited(
      req,
      ctx,
      {
        action: "access.role.assigned",
        targetType: "user",
        targetId: userId,
        reason,
        details: { role_id: roleId, role: role.name, scope, expires_at: expiresAt },
      },
      [
        db`
          DELETE FROM user_roles
          WHERE user_id = ${userId}
            AND role_id = ${roleId}
            AND company_id IS NOT DISTINCT FROM ${scope.companyId}::int
            AND department_id IS NOT DISTINCT FROM ${scope.departmentId}::int
        `,
        db`
          INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, expires_at, assigned_by, reason)
          VALUES (${userId}, ${roleId}, ${scope.level}, ${scope.companyId}, ${scope.departmentId}, ${expiresAt}, ${ctx.userId}, ${reason})
        `,
      ]
    );
  } catch (error: any) {
    // Until rbac-migration-2-multi-scope.sql is run, a role can be held in one scope only
    if (error?.code === "23505") {
      return withCors(req, {
        success: false,
        error: "User already holds this role in another scope. Remove that assignment first.",
      }, 409);
    }
    throw error;
  }

  return withCors(req, { success: true, message: "Role assigned to user successfully" });
}

// ---------------- UNASSIGN ROLE ----------------
async function unassignRole(req: NextRequest, ctx: AuthContext, body: any) {
  const userId = body.user_id == null ? "" : String(body.user_id).trim();
  const roleId = Number(body.role_id);
  const reason = readReason(body.reason);

  if (!userId || !Number.isInteger(roleId)) {
    return withCors(req, { success: false, error: "user_id and role_id are required" }, 400);
  }
  if (!reason) {
    return withCors(req, { success: false, error: "reason is required" }, 400);
  }
  if (userId === ctx.userId) {
    return withCors(req, { success: false, error: "You cannot change your own access" }, 403);
  }

  // company_id / department_id narrow the removal to one scope; omitted = every scope
  const companyId = body.company_id == null ? null : Number(body.company_id);
  const departmentId = body.department_id == null ? null : Number(body.department_id);

  const assignments = await db`
    SELECT id, scope_level, company_id, department_id
    FROM user_roles
    WHERE user_id = ${userId}
      AND role_id = ${roleId}
      AND (${companyId}::int IS NULL OR company_id = ${companyId})
      AND (${departmentId}::int IS NULL OR department_id = ${departmentId})
  `;

  if (assignments.length === 0) {
    return withCors(req, { success: false, error: "User does not have this role" }, 404);
  }

  if (!assignments.every((a) => covers(ctx, "access.roles.assign", rowScope(a)))) {
    return withCors(req, { success: false, error: "This assignment is outside your organisational scope" }, 403);
  }

  const privileged = await db`
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ${roleId} AND p.is_privileged
    LIMIT 1
  `;
  if (privileged.length > 0 && !can(ctx, "access.privileged.grant")) {
    return withCors(req, {
      success: false,
      error: "This role contains privileged permissions and needs access.privileged.grant to revoke",
    }, 403);
  }

  const ids = assignments.map((a) => Number(a.id));

  await runAudited(
    req,
    ctx,
    {
      action: "access.role.revoked",
      targetType: "user",
      targetId: userId,
      reason,
      details: { role_id: roleId, scopes: assignments.map(rowScope) },
    },
    [db`DELETE FROM user_roles WHERE id = ANY(${ids}::bigint[])`]
  );

  return withCors(req, { success: true, message: "Role removed from user successfully" });
}

// ---------------- CREATE ROLE / ASSIGN ROLE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") {
      return withCors(req, { success: false, error: "Send the request body as valid JSON" }, 400);
    }
    const { action } = body;

    if (action === "assign" || action === "unassign") {
      const auth = await requirePermission(req, "access.roles.assign");
      if (!auth.ok) return auth.response;

      return action === "assign"
        ? await assignRole(req, auth.ctx, body)
        : await unassignRole(req, auth.ctx, body);
    }

    // Default: Create new role
    const auth = await requirePermission(req, "access.roles.manage");
    if (!auth.ok) return auth.response;

    const { name, description } = body;
    if (!name || typeof name !== "string") {
      return withCors(req, { success: false, error: "Role name is required" }, 400);
    }

    const key = slugify(typeof body.key === "string" && body.key ? body.key : name);
    if (!key) {
      return withCors(req, { success: false, error: "Role name must contain letters or numbers" }, 400);
    }

    const defaultScope = body.default_scope ?? "department";
    if (!["global", "mda", "department", "self"].includes(defaultScope)) {
      return withCors(req, { success: false, error: "default_scope must be one of: global, mda, department, self" }, 400);
    }

    const duplicate = await db`SELECT id FROM roles WHERE name = ${name} OR key = ${key}`;
    if (duplicate.length > 0) {
      return withCors(req, { success: false, error: "A role with this name already exists" }, 409);
    }

    const [result] = await runAudited(
      req,
      auth.ctx,
      { action: "access.role.created", targetType: "role", targetId: key, reason: readReason(body.reason), details: { name } },
      [
        db`
          INSERT INTO roles (key, name, description, default_scope, created_at, updated_at)
          VALUES (${key}, ${name}, ${description || null}, ${defaultScope}, NOW(), NOW())
          RETURNING *
        `,
      ]
    );

    const newRole = result?.[0];
    const newRoleId = newRole?.id ? Number(newRole.id) : null;
    const rawPermIds = body.permission_ids ?? body.permissions;
    if (newRoleId && Array.isArray(rawPermIds) && rawPermIds.length > 0) {
      const permIds = rawPermIds.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
      for (const pid of permIds) {
        await db`INSERT INTO role_permissions (role_id, permission_id) VALUES (${newRoleId}, ${pid}) ON CONFLICT DO NOTHING`;
      }
    }

    return withCors(req, {
      success: true,
      message: "Role created successfully",
      data: result?.[0]
    });
  } catch (error: any) {
    console.error("CREATE ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to process role request" }, 500);
  }
}

// ---------------- READ ROLES ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleId = searchParams.get("id");
    const userId = searchParams.get("user_id");

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    // Anyone may see their own roles; everything else needs access.roles.view
    const ownRoles = userId !== null && userId === ctx.userId;
    if (!ownRoles && !can(ctx, "access.roles.view")) {
      return withCors(req, {
        success: false,
        error: "You do not have permission to perform this action",
        required: "access.roles.view",
      }, 403);
    }

    if (roleId) {
      const role = await db`SELECT * FROM roles WHERE id = ${roleId}`;
      if (!role[0]) return withCors(req, { success: false, error: "Role not found" }, 404);

      const permissions = await db`
        SELECT p.*
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = ${roleId}
        ORDER BY p.key ASC
      `;
      return withCors(req, { success: true, data: { ...role[0], permissions } });
    }

    if (userId) {
      // Get roles for a specific user
      const userRoles = await db`
        SELECT r.*, ur.id AS assignment_id, ur.scope_level,
               ur.company_id, c.name AS company_name,
               ur.department_id, d.name AS department_name,
               ur.expires_at, ur.assigned_by, ur.assigned_at
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        LEFT JOIN companies c ON c.id = ur.company_id
        LEFT JOIN departments d ON d.id = ur.department_id
        WHERE ur.user_id = ${userId}
        ORDER BY ur.assigned_at DESC
      `;

      const visible = ownRoles
        ? userRoles
        : userRoles.filter((row) => covers(ctx, "access.roles.view", rowScope(row)));

      return withCors(req, { success: true, data: visible });
    }

    const roles = await db`
      SELECT r.*,
             COALESCE(
               (
                 SELECT json_agg(p.* ORDER BY p.key ASC)
                 FROM role_permissions rp
                 JOIN permissions p ON p.id = rp.permission_id
                 WHERE rp.role_id = r.id
               ),
               '[]'::json
             ) AS permissions
      FROM roles r
      ORDER BY r.id ASC
    `;
    return withCors(req, { success: true, data: roles });
  } catch (error: any) {
    console.error("GET ROLES ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch roles" }, 500);
  }
}

// ---------------- UPDATE ROLE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "access.roles.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") {
      return withCors(req, { success: false, error: "Send the request body as valid JSON" }, 400);
    }
    const { id, name, description, status, default_scope } = body;

    if (!id) return withCors(req, { success: false, error: "Role id is required" }, 400);

    const existing = await db`SELECT * FROM roles WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Role not found" }, 404);

    // Built-in templates keep their name, status and scope; only the description is editable
    if (existing[0].is_system && (name !== undefined || status !== undefined || default_scope !== undefined)) {
      return withCors(req, { success: false, error: "Built-in roles can only have their description changed" }, 403);
    }
    if (status !== undefined && !["active", "retired"].includes(status)) {
      return withCors(req, { success: false, error: "status must be active or retired" }, 400);
    }
    if (default_scope !== undefined && !["global", "mda", "department", "self"].includes(default_scope)) {
      return withCors(req, { success: false, error: "default_scope must be one of: global, mda, department, self" }, 400);
    }

    const newName = name ?? existing[0].name;
    const newDesc = description !== undefined ? description : existing[0].description;
    const newStatus = status ?? existing[0].status;
    const newScope = default_scope ?? existing[0].default_scope;

    const [updated] = await runAudited(
      req,
      auth.ctx,
      {
        action: newStatus !== existing[0].status ? `access.role.${newStatus === "retired" ? "retired" : "reactivated"}` : "access.role.updated",
        targetType: "role",
        targetId: id,
        reason: readReason(body.reason),
        details: { name: newName, status: newStatus, default_scope: newScope },
      },
      [
        db`
          UPDATE roles
          SET name = ${newName}, description = ${newDesc}, status = ${newStatus}, default_scope = ${newScope}, updated_at = NOW()
          WHERE id = ${id} RETURNING *
        `,
      ]
    );

    const rawPermIds = body.permission_ids ?? body.permissions;
    if (Array.isArray(rawPermIds)) {
      const permIds = rawPermIds.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
      await db`DELETE FROM role_permissions WHERE role_id = ${Number(id)}`;
      for (const pid of permIds) {
        await db`INSERT INTO role_permissions (role_id, permission_id) VALUES (${Number(id)}, ${pid}) ON CONFLICT DO NOTHING`;
      }
    }

    return withCors(req, { success: true, message: "Role updated", data: updated?.[0] });
  } catch (error: any) {
    console.error("UPDATE ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to update role" }, 500);
  }
}

// ---------------- DELETE ROLE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "access.roles.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, error: "Role id is required" }, 400);

    const existing = await db`SELECT * FROM roles WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Role not found" }, 404);

    if (existing[0].is_system) {
      return withCors(req, { success: false, error: "Built-in roles cannot be deleted" }, 403);
    }

    const assigned = await db`SELECT COUNT(*)::int AS count FROM user_roles WHERE role_id = ${id}`;
    if (Number(assigned[0]?.count ?? 0) > 0) {
      return withCors(req, {
        success: false,
        error: "Role is still assigned to users. Retire it (status: retired) or remove the assignments first.",
      }, 409);
    }

    await runAudited(
      req,
      auth.ctx,
      {
        action: "access.role.deleted",
        targetType: "role",
        targetId: id,
        reason: readReason(searchParams.get("reason")),
        details: { name: existing[0].name },
      },
      [db`DELETE FROM roles WHERE id = ${id}`]
    );

    return withCors(req, { success: true, message: "Role deleted successfully" });
  } catch (error: any) {
    console.error("DELETE ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to delete role" }, 500);
  }
}
