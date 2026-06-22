import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

/**
 * =========================
 * TYPES
 * =========================
 */

type PermissionAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "approve"
  | "review"
  | "reject"
  | "export";

type CreatePermissionBody = {
  action: "create_permission";
  name: string;
  resource: string;
  permission_action: PermissionAction;
  description?: string;
};

type AssignUserBody = {
  action: "assign_user" | "unassign_user";
  user_id: string;
  permission_id: number;
};

type AssignRoleBody = {
  action: "assign_role" | "unassign_role";
  role_id: number;
  permission_id: number;
};

type RequestBody =
  | CreatePermissionBody
  | AssignUserBody
  | AssignRoleBody;

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

      const result = await db`
        INSERT INTO permissions (
          name,
          resource,
          action,
          description,
          created_at,
          updated_at
        )
        VALUES (
          ${b.name},
          ${b.resource},
          ${b.permission_action},
          ${b.description || null},
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      return withCors(req, {
        success: true,
        message: "Permission created successfully",
        data: result[0],
      });
    }

    /**
     * =========================
     * USER PERMISSION ASSIGN / REMOVE
     * =========================
     */
    if (body.action === "assign_user" || body.action === "unassign_user") {
      const b = body as AssignUserBody;

      if (!b.user_id || !b.permission_id) {
        return withCors(req, {
          success: false,
          error: "user_id and permission_id required",
        }, 400);
      }

      // ASSIGN
      if (b.action === "assign_user") {
        await db`
          INSERT INTO user_permissions (user_id, permission_id)
          VALUES (${b.user_id}, ${b.permission_id})
          ON CONFLICT DO NOTHING
        `;

        return withCors(req, {
          success: true,
          message: "Permission assigned to user",
        });
      }

      // UNASSIGN
      await db`
        DELETE FROM user_permissions
        WHERE user_id = ${b.user_id}
        AND permission_id = ${b.permission_id}
      `;

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

      if (!b.role_id || !b.permission_id) {
        return withCors(req, {
          success: false,
          error: "role_id and permission_id required",
        }, 400);
      }

      // CHECK ROLE EXISTS
      const role = await db`
        SELECT id FROM roles WHERE id = ${b.role_id}
      `;

      if (!role[0]) {
        return withCors(req, {
          success: false,
          error: "Role not found",
        }, 404);
      }

      // ASSIGN
      if (b.action === "assign_role") {
        await db`
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES (${b.role_id}, ${b.permission_id})
          ON CONFLICT DO NOTHING
        `;

        return withCors(req, {
          success: true,
          message: "Permission assigned to role",
        });
      }

      // UNASSIGN
      await db`
        DELETE FROM role_permissions
        WHERE role_id = ${b.role_id}
        AND permission_id = ${b.permission_id}
      `;

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
        SELECT DISTINCT p.*
        FROM permissions p
        LEFT JOIN user_permissions up
          ON up.permission_id = p.id AND up.user_id = ${userId}
        LEFT JOIN role_permissions rp
          ON rp.permission_id = p.id
        LEFT JOIN user_roles ur
          ON ur.role_id = rp.role_id AND ur.user_id = ${userId}
        WHERE up.user_id IS NOT NULL OR ur.user_id IS NOT NULL
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
    const body = (await req.json()) as {
      id: number;
      name?: string;
      resource?: string;
      action?: PermissionAction;
      description?: string;
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

    const updated = await db`
      UPDATE permissions
      SET
        name = COALESCE(${body.name}, name),
        resource = COALESCE(${body.resource}, resource),
        action = COALESCE(${body.action}, action),
        description = COALESCE(${body.description}, description),
        updated_at = NOW()
      WHERE id = ${body.id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Permission updated successfully",
      data: updated[0],
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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, {
        success: false,
        error: "id required",
      }, 400);
    }

    await db`DELETE FROM permissions WHERE id = ${id}`;

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