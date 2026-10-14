import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import {
  authenticate,
  requirePermission,
  can,
  covers,
  scopeOf,
  resolveScope,
  loadGrants,
  sodConflicts,
  sodKeys,
  runAudited,
  readReason,
  type AuthContext,
} from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const MANAGE = "access.permissions.manage";

/**
 * =========================
 * TYPES
 * =========================
 */

type PermissionAction =
  | "create"
  | "read"
  | "view"
  | "update"
  | "delete"
  | "manage"
  | "approve"
  | "review"
  | "reject"
  | "export";

type CreatePermissionBody = {
  action: "create_permission";
  name: string;
  module?: string;
  resource: string;
  permission_action: PermissionAction;
  description?: string;
  reason?: string;
};

type AssignUserBody = {
  action: "assign_user" | "unassign_user";
  user_id: string;
  permission_id: number;
  scope_level?: string;
  company_id?: number;
  department_id?: number;
  expires_at?: string;
  reason: string;
};

type AssignRoleBody = {
  action: "assign_role" | "unassign_role";
  role_id: number;
  permission_id: number;
  reason: string;
};

type RequestBody =
  | CreatePermissionBody
  | AssignUserBody
  | AssignRoleBody;

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// module.resource.action
function buildKey(module: string | undefined | null, resource: string, action: string): string | null {
  const parts = [slug(module || "custom"), slug(resource), slug(action)];
  return parts.every(Boolean) ? parts.join(".") : null;
}

// The catalogue and role definitions apply to every MDA, so changing them needs global scope
function requireGlobal(req: NextRequest, ctx: AuthContext) {
  if (scopeOf(ctx, MANAGE).global) return null;
  return withCors(req, {
    success: false,
    error: "Changing roles and the permission catalogue requires global scope",
  }, 403);
}

/**
 * =========================
 * OPTIONS
 * =========================
 */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * =========================
 * POST ROUTE (CREATE / ASSIGN / REMOVE)
 * =========================
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json()) as RequestBody;

    if (!body?.action) {
      return withCors(req, { success: false, error: "action is required" }, 400);
    }

    /**
     * =========================
     * CREATE PERMISSION
     * =========================
     */
    if (body.action === "create_permission") {
      const b = body as CreatePermissionBody;

      if (!b.name || !b.resource || !b.permission_action) {
        return withCors(req, {
          success: false,
          error: "name, resource, permission_action required",
        }, 400);
      }

      const notGlobal = requireGlobal(req, ctx);
      if (notGlobal) return notGlobal;

      const key = buildKey(b.module, b.resource, b.permission_action);
      if (!key) {
        return withCors(req, {
          success: false,
          error: "module, resource and permission_action must contain letters or numbers",
        }, 400);
      }

      const duplicate = await db`SELECT id FROM permissions WHERE key = ${key} OR name = ${b.name}`;
      if (duplicate.length > 0) {
        return withCors(req, { success: false, error: `Permission ${key} already exists` }, 409);
      }

      const [result] = await runAudited(
        req,
        ctx,
        { action: "access.permission.created", targetType: "permission", targetId: key, reason: readReason(b.reason), details: { name: b.name } },
        [
          db`
            INSERT INTO permissions (
              key,
              module,
              name,
              resource,
              action,
              description,
              created_at,
              updated_at
            )
            VALUES (
              ${key},
              ${key.split(".")[0] ?? null},
              ${b.name},
              ${slug(b.resource)},
              ${slug(b.permission_action)},
              ${b.description || null},
              NOW(),
              NOW()
            )
            RETURNING *
          `,
        ]
      );

      return withCors(req, {
        success: true,
        message: "Permission created successfully",
        data: result?.[0],
      });
    }

    /**
     * =========================
     * USER PERMISSION ASSIGN / REMOVE
     * =========================
     */
    if (body.action === "assign_user" || body.action === "unassign_user") {
      const b = body as AssignUserBody;
      const userId = b.user_id == null ? "" : String(b.user_id).trim();
      const permissionId = Number(b.permission_id);
      const reason = readReason(b.reason);

      if (!userId || !Number.isInteger(permissionId)) {
        return withCors(req, {
          success: false,
          error: "user_id and permission_id required",
        }, 400);
      }
      if (!reason) {
        return withCors(req, { success: false, error: "reason is required" }, 400);
      }
      if (userId === ctx.userId) {
        return withCors(req, { success: false, error: "You cannot change your own access" }, 403);
      }

      const permRows = await db`SELECT id, key, is_privileged FROM permissions WHERE id = ${permissionId}`;
      const perm = permRows[0];
      if (!perm) {
        return withCors(req, { success: false, error: "Permission not found" }, 404);
      }
      if (perm.is_privileged && !can(ctx, "access.privileged.grant")) {
        return withCors(req, {
          success: false,
          error: "This is a privileged permission and needs access.privileged.grant",
        }, 403);
      }

      // ASSIGN
      if (b.action === "assign_user") {
        if (!perm.key) {
          return withCors(req, { success: false, error: "Permission has no key and cannot be granted" }, 409);
        }

        const resolved = await resolveScope(b.scope_level ?? "self", b.company_id, b.department_id);
        if ("error" in resolved) {
          return withCors(req, { success: false, error: resolved.error }, 400);
        }
        const scope = resolved.scope;

        if (!covers(ctx, MANAGE, scope)) {
          return withCors(req, { success: false, error: "This assignment is outside your organisational scope" }, 403);
        }

        let expiresAt: string | null = null;
        if (b.expires_at != null && b.expires_at !== "") {
          const date = new Date(b.expires_at);
          if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
            return withCors(req, { success: false, error: "expires_at must be a future date" }, 400);
          }
          expiresAt = date.toISOString();
        }

        const held = sodKeys(await loadGrants(userId));
        const conflicts = await sodConflicts([...new Set([...held, String(perm.key)])]);
        if (conflicts.length > 0) {
          return withCors(req, {
            success: false,
            error: "Assignment would break separation-of-duties rules",
            conflicts,
          }, 409);
        }

        await runAudited(
          req,
          ctx,
          {
            action: "access.permission.granted",
            targetType: "user",
            targetId: userId,
            reason,
            details: { permission: perm.key, scope, expires_at: expiresAt },
          },
          [
            db`
              INSERT INTO user_permissions (user_id, permission_id, scope_level, company_id, department_id, expires_at, assigned_by, reason)
              VALUES (${userId}, ${permissionId}, ${scope.level}, ${scope.companyId}, ${scope.departmentId}, ${expiresAt}, ${ctx.userId}, ${reason})
              ON CONFLICT (user_id, permission_id)
              DO UPDATE SET
                scope_level = EXCLUDED.scope_level,
                company_id = EXCLUDED.company_id,
                department_id = EXCLUDED.department_id,
                expires_at = EXCLUDED.expires_at,
                assigned_by = EXCLUDED.assigned_by,
                assigned_at = NOW(),
                reason = EXCLUDED.reason
            `,
          ]
        );

        return withCors(req, {
          success: true,
          message: "Permission assigned to user",
        });
      }

      // UNASSIGN
      const existing = await db`
        SELECT scope_level, company_id, department_id
        FROM user_permissions
        WHERE user_id = ${userId} AND permission_id = ${permissionId}
      `;
      const grant = existing[0];
      if (!grant) {
        return withCors(req, { success: false, error: "User does not have this permission" }, 404);
      }

      const grantScope = {
        level: grant.scope_level,
        companyId: grant.company_id == null ? null : Number(grant.company_id),
        departmentId: grant.department_id == null ? null : Number(grant.department_id),
      };
      if (!covers(ctx, MANAGE, grantScope)) {
        return withCors(req, { success: false, error: "This assignment is outside your organisational scope" }, 403);
      }

      await runAudited(
        req,
        ctx,
        {
          action: "access.permission.revoked",
          targetType: "user",
          targetId: userId,
          reason,
          details: { permission: perm.key, scope: grantScope },
        },
        [
          db`
            DELETE FROM user_permissions
            WHERE user_id = ${userId}
            AND permission_id = ${permissionId}
          `,
        ]
      );

      return withCors(req, {
        success: true,
        message: "Permission removed from user",
      });
    }

    /**
     * =========================
     * ROLE PERMISSION ASSIGN / REMOVE
     * (Maker / Reviewer / Approver model)
     * =========================
     */
    if (body.action === "assign_role" || body.action === "unassign_role") {
      const b = body as AssignRoleBody;
      const roleId = Number(b.role_id);
      const permissionId = Number(b.permission_id);
      const reason = readReason(b.reason);

      if (!Number.isInteger(roleId) || !Number.isInteger(permissionId)) {
        return withCors(req, {
          success: false,
          error: "role_id and permission_id required",
        }, 400);
      }
      if (!reason) {
        return withCors(req, { success: false, error: "reason is required" }, 400);
      }

      const notGlobal = requireGlobal(req, ctx);
      if (notGlobal) return notGlobal;

      // CHECK ROLE EXISTS
      const role = await db`
        SELECT id, name, sod_exempt FROM roles WHERE id = ${roleId}
      `;

      if (!role[0]) {
        return withCors(req, {
          success: false,
          error: "Role not found",
        }, 404);
      }

      // Editing a role you hold would be granting access to yourself
      const holdsRole = await db`
        SELECT 1 FROM user_roles WHERE user_id = ${ctx.userId} AND role_id = ${roleId} LIMIT 1
      `;
      if (holdsRole.length > 0) {
        return withCors(req, { success: false, error: "You cannot change the permissions of a role you hold" }, 403);
      }

      const permRows = await db`SELECT id, key, is_privileged FROM permissions WHERE id = ${permissionId}`;
      const perm = permRows[0];
      if (!perm) {
        return withCors(req, { success: false, error: "Permission not found" }, 404);
      }
      if (perm.is_privileged && !can(ctx, "access.privileged.grant")) {
        return withCors(req, {
          success: false,
          error: "This is a privileged permission and needs access.privileged.grant",
        }, 403);
      }

      // ASSIGN
      if (b.action === "assign_role") {
        if (!perm.key) {
          return withCors(req, { success: false, error: "Permission has no key and cannot be granted" }, 409);
        }

        if (!role[0].sod_exempt) {
          const current = await db`
            SELECT p.key
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id AND p.key IS NOT NULL
            WHERE rp.role_id = ${roleId}
          `;
          const combined = [...new Set([...current.map((p) => String(p.key)), String(perm.key)])];
          const conflicts = await sodConflicts(combined);
          if (conflicts.length > 0) {
            return withCors(req, {
              success: false,
              error: "This would put conflicting permissions in one role (separation of duties)",
              conflicts,
            }, 409);
          }
        }

        await runAudited(
          req,
          ctx,
          {
            action: "access.role.permission_added",
            targetType: "role",
            targetId: roleId,
            reason,
            details: { role: role[0].name, permission: perm.key },
          },
          [
            db`
              INSERT INTO role_permissions (role_id, permission_id)
              VALUES (${roleId}, ${permissionId})
              ON CONFLICT DO NOTHING
            `,
          ]
        );

        return withCors(req, {
          success: true,
          message: "Permission assigned to role",
        });
      }

      // UNASSIGN
      await runAudited(
        req,
        ctx,
        {
          action: "access.role.permission_removed",
          targetType: "role",
          targetId: roleId,
          reason,
          details: { role: role[0].name, permission: perm.key },
        },
        [
          db`
            DELETE FROM role_permissions
            WHERE role_id = ${roleId}
            AND permission_id = ${permissionId}
          `,
        ]
      );

      return withCors(req, {
        success: true,
        message: "Permission removed from role",
      });
    }

    return withCors(req, {
      success: false,
      error: "Invalid action",
    }, 400);
  } catch (error: any) {
    console.error("PERMISSION ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Server error",
    }, 500);
  }
}

/**
 * =========================
 * GET PERMISSIONS
 * =========================
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const userId = searchParams.get("user_id");
    const roleId = searchParams.get("role_id");
    const id = searchParams.get("id");

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    // Anyone may see their own permissions; everything else needs access.permissions.view
    const ownPermissions = userId !== null && userId === auth.ctx.userId;
    if (!ownPermissions && !can(auth.ctx, "access.permissions.view")) {
      return withCors(req, {
        success: false,
        error: "You do not have permission to perform this action",
        required: "access.permissions.view",
      }, 403);
    }

    /**
     * SINGLE PERMISSION
     */
    if (id) {
      const perm = await db`
        SELECT * FROM permissions WHERE id = ${id}
      `;

      if (!perm[0]) {
        return withCors(req, { success: false, error: "Not found" }, 404);
      }

      return withCors(req, { success: true, data: perm[0] });
    }

    /**
     * USER PERMISSIONS (ROLE + DIRECT)
     */
    if (userId) {
      const perms = await db`
        SELECT p.*
        FROM permissions p
        WHERE p.id IN (
          SELECT up.permission_id
          FROM user_permissions up
          WHERE up.user_id = ${userId}
            AND (up.expires_at IS NULL OR up.expires_at > NOW())

          UNION

          SELECT rp.permission_id
          FROM role_permissions rp
          JOIN roles r ON r.id = rp.role_id AND r.status = 'active'
          JOIN user_roles ur ON ur.role_id = r.id
          WHERE ur.user_id = ${userId}
            AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        )
        ORDER BY p.id ASC
      `;

      return withCors(req, { success: true, data: perms });
    }

    /**
     * ROLE PERMISSIONS
     */
    if (roleId) {
      const perms = await db`
        SELECT p.*
        FROM permissions p
        JOIN role_permissions rp
          ON rp.permission_id = p.id
        WHERE rp.role_id = ${roleId}
      `;

      return withCors(req, { success: true, data: perms });
    }

    /**
     * ALL PERMISSIONS
     */
    const all = await db`
      SELECT * FROM permissions ORDER BY id ASC
    `;

    return withCors(req, { success: true, data: all });
  } catch (error: any) {
    console.error("GET PERMISSIONS ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to fetch permissions",
    }, 500);
  }
}

/**
 * =========================
 * UPDATE PERMISSION
 * =========================
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const notGlobal = requireGlobal(req, auth.ctx);
    if (notGlobal) return notGlobal;

    const body = (await req.json()) as {
      id: number;
      name?: string;
      resource?: string;
      action?: PermissionAction;
      description?: string;
      reason?: string;
    };

    if (!body.id) {
      return withCors(req, {
        success: false,
        error: "id required",
      }, 400);
    }

    const existing = await db`
      SELECT * FROM permissions WHERE id = ${body.id}
    `;

    if (!existing[0]) {
      return withCors(req, {
        success: false,
        error: "Permission not found",
      }, 404);
    }

    // Route guards check built-in keys by name, so their resource/action are fixed
    if (existing[0].is_system && (body.resource !== undefined || body.action !== undefined)) {
      return withCors(req, {
        success: false,
        error: "Built-in permissions can only have their name and description changed",
      }, 403);
    }

    const resource = body.resource !== undefined ? slug(body.resource) : existing[0].resource;
    const action = body.action !== undefined ? slug(body.action) : existing[0].action;
    const key = existing[0].is_system ? existing[0].key : buildKey(existing[0].module, resource, action);

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: "access.permission.updated", targetType: "permission", targetId: body.id, reason: readReason(body.reason), details: { key } },
      [
        db`
          UPDATE permissions
          SET
            name = COALESCE(${body.name ?? null}, name),
            resource = ${resource},
            action = ${action},
            key = ${key},
            description = COALESCE(${body.description ?? null}, description),
            updated_at = NOW()
          WHERE id = ${body.id}
          RETURNING *
        `,
      ]
    );

    return withCors(req, {
      success: true,
      message: "Permission updated successfully",
      data: updated?.[0],
    });
  } catch (error: any) {
    console.error("PATCH ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to update permission",
    }, 500);
  }
}

/**
 * =========================
 * DELETE PERMISSION
 * =========================
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const notGlobal = requireGlobal(req, auth.ctx);
    if (notGlobal) return notGlobal;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, {
        success: false,
        error: "id required",
      }, 400);
    }

    const existing = await db`SELECT id, key, name, is_system FROM permissions WHERE id = ${id}`;
    if (!existing[0]) {
      return withCors(req, { success: false, error: "Permission not found" }, 404);
    }
    if (existing[0].is_system) {
      return withCors(req, { success: false, error: "Built-in permissions cannot be deleted" }, 403);
    }

    await runAudited(
      req,
      auth.ctx,
      {
        action: "access.permission.deleted",
        targetType: "permission",
        targetId: id,
        reason: readReason(searchParams.get("reason")),
        details: { key: existing[0].key, name: existing[0].name },
      },
      [db`DELETE FROM permissions WHERE id = ${id}`]
    );

    return withCors(req, {
      success: true,
      message: "Permission deleted successfully",
    });
  } catch (error: any) {
    console.error("DELETE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to delete permission",
    }, 500);
  }
}
