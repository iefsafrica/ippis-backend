import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import {
  formatUserAccount,
  loadUserRolesMap,
  resolveValidScope,
  UserRoleRecord,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);
const ASSIGN_PERMISSION = "access.roles.assign";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, ASSIGN_PERMISSION);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json()) as any;
    const { user_ids, role_id, action, role_action, reason } = body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return withCors(req, { success: false, error: "user_ids must be a non-empty array" }, 400);
    }

    if (!role_id) {
      return withCors(req, { success: false, error: "role_id is required" }, 400);
    }

    const targetRoleId = Number(role_id);
    const roleRows = await db`SELECT id, name, description, key, default_scope FROM roles WHERE id = ${targetRoleId}`;
    const targetRole = roleRows[0];
    if (!targetRole) {
      return withCors(req, { success: false, error: "Role not found" }, 404);
    }

    // Determine whether this request is a preview or execution
    const isPreview = action === "preview";
    const effectiveAction: "assign" | "revoke" =
      role_action === "assign" || role_action === "revoke"
        ? role_action
        : action === "revoke"
        ? "revoke"
        : "assign";

    const cleanUserIds = user_ids.map(String);

    // Fetch user details
    const users = await db`
      SELECT u.id, u.username, u.email, u.full_name, u.staff_id, u.phone,
             u.role, u.is_active, u.status, u.mda_id, u.department_id,
             u.scope_level, u.notes, u.last_login, u.created_at, u.updated_at,
             c.name AS mda_name, d.name AS department_name
      FROM admin_users u
      LEFT JOIN companies c ON c.id = u.mda_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ANY(${cleanUserIds}::int[])
    `;

    const allRoles = await db`SELECT id, name, description, key FROM roles WHERE status = 'active'`;
    const rolesMap = await loadUserRolesMap(users.map((u) => u.id));

    let applicableCount = 0;
    let alreadyInStateCount = 0;

    const affectedUsers = users.map((u) => {
      const userRoles = rolesMap[String(u.id)] || [];
      const formattedUser = formatUserAccount(u, userRoles, allRoles.map(r => ({ id: Number(r.id), name: String(r.name) })));
      const hasRole = userRoles.some((r) => Number(r.id) === targetRoleId);

      let willChange = false;
      let actionSummary = "";

      if (effectiveAction === "assign") {
        if (hasRole) {
          alreadyInStateCount++;
          actionSummary = `Already possesses '${targetRole.name}'`;
        } else {
          willChange = true;
          applicableCount++;
          actionSummary = `Will be assigned '${targetRole.name}'`;
        }
      } else {
        if (hasRole) {
          willChange = true;
          applicableCount++;
          actionSummary = `Will have '${targetRole.name}' revoked`;
        } else {
          alreadyInStateCount++;
          actionSummary = `Does not have '${targetRole.name}'`;
        }
      }

      return {
        user: formattedUser,
        current_roles: userRoles,
        will_change: willChange,
        action_summary: actionSummary,
      };
    });

    // If PREVIEW: return affected users report immediately
    if (isPreview) {
      return withCors(req, {
        success: true,
        data: {
          target_role: {
            id: Number(targetRole.id),
            name: String(targetRole.name),
            description: targetRole.description ? String(targetRole.description) : null,
            key: targetRole.key ? String(targetRole.key) : null,
          },
          action: effectiveAction,
          affected_users: affectedUsers,
          total_selected: users.length,
          applicable_count: applicableCount,
          already_in_state_count: alreadyInStateCount,
        },
      });
    }

    // If EXECUTION: validate reason
    const cleanReason = readReason(reason);
    if (!cleanReason) {
      return withCors(req, { success: false, error: "A justification reason is required for bulk role operations" }, 400);
    }

    const items: Array<{
      user_id: string | number;
      user_name: string;
      status: "success" | "skipped" | "error";
      message: string;
    }> = [];

    let succeeded = 0;

    for (const item of affectedUsers) {
      if (!item.will_change) {
        items.push({
          user_id: item.user.id,
          user_name: item.user.full_name,
          status: "skipped",
          message: item.action_summary,
        });
        continue;
      }

      try {
        const uidStr = String(item.user.id);
        if (effectiveAction === "assign") {
          const validScope = resolveValidScope(
            item.user.scope_level,
            item.user.mda_id ? Number(item.user.mda_id) : null,
            item.user.department_id ? Number(item.user.department_id) : null
          );
          await db`
            INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, assigned_by, reason)
            VALUES (
              ${uidStr}, ${targetRoleId}, ${validScope.scope_level},
              ${validScope.company_id},
              ${validScope.department_id},
              ${ctx.userId}, ${cleanReason}
            )
            ON CONFLICT DO NOTHING
          `;
        } else {
          await db`
            DELETE FROM user_roles
            WHERE user_id = ${uidStr} AND role_id = ${targetRoleId}
          `;
        }

        succeeded++;
        items.push({
          user_id: item.user.id,
          user_name: item.user.full_name,
          status: "success",
          message: `Successfully ${effectiveAction === "assign" ? "assigned" : "revoked"} role`,
        });
      } catch (err: any) {
        console.error(`Error updating role for user ${item.user.id}:`, err);
        items.push({
          user_id: item.user.id,
          user_name: item.user.full_name,
          status: "error",
          message: err.message || "Failed to update role",
        });
      }
    }

    // Record audit event
    await runAudited(
      req,
      ctx,
      {
        action: "BULK_ROLE_CHANGE",
        targetType: "user",
        targetId: `MULTIPLE (${succeeded})`,
        reason: cleanReason,
        details: {
          action: effectiveAction,
          role: targetRole.name,
          total_processed: users.length,
          succeeded_count: succeeded,
        },
      },
      []
    );

    return withCors(req, {
      success: true,
      timestamp: new Date().toISOString(),
      action: effectiveAction,
      role_name: String(targetRole.name),
      total_processed: users.length,
      succeeded_count: succeeded,
      failed_count: items.filter((i) => i.status === "error").length,
      reason: cleanReason,
      items,
    });
  } catch (error: any) {
    console.error("BULK ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to process bulk role operation" }, 500);
  }
}
