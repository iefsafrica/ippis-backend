import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../lib/cors";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE PERMISSION / ASSIGN PERMISSION ----------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { action } = body;

    // Assign permission to user
    if (action === "assign_user") {
      const { user_id, permission_id } = body;
      if (!user_id || !permission_id) return withCors(req, { success: false, error: "user_id and permission_id required" }, 400);

      // Check if user exists in employees or registrations table
      let empCheck;
      try {
        empCheck = await db`SELECT registration_id FROM employees WHERE registration_id = ${user_id}`;
      } catch (e) {
        empCheck = [];
      }
      
      if (empCheck.length === 0) {
        try {
          empCheck = await db`SELECT registration_id FROM registrations WHERE registration_id = ${user_id}`;
        } catch (e) {
          empCheck = [];
        }
      }

      if (empCheck.length === 0) {
        return withCors(req, { success: false, error: "User ID does not exist in employees table" }, 404);
      }

      await db`
        INSERT INTO user_permissions (user_id, permission_id) 
        VALUES (${user_id}, ${permission_id})
        ON CONFLICT DO NOTHING
      `;
      return withCors(req, { success: true, message: "Permission assigned to user successfully" });
    } 
    // Unassign permission from user
    else if (action === "unassign_user") {
      const { user_id, permission_id } = body;
      if (!user_id || !permission_id) return withCors(req, { success: false, error: "user_id and permission_id required" }, 400);

      // Check if user exists in employees or registrations table
      let empCheck;
      try {
        empCheck = await db`SELECT registration_id FROM employees WHERE registration_id = ${user_id}`;
      } catch (e) {
        empCheck = [];
      }
      
      if (empCheck.length === 0) {
        try {
          empCheck = await db`SELECT registration_id FROM registrations WHERE registration_id = ${user_id}`;
        } catch (e) {
          empCheck = [];
        }
      }

      if (empCheck.length === 0) {
        return withCors(req, { success: false, error: "User ID does not exist in employees table" }, 404);
      }

      await db`DELETE FROM user_permissions WHERE user_id = ${user_id} AND permission_id = ${permission_id}`;
      return withCors(req, { success: true, message: "Permission removed from user successfully" });
    }
    // Assign permission to role
    else if (action === "assign_role") {
      const { role_id, permission_id } = body;
      if (!role_id || !permission_id) return withCors(req, { success: false, error: "role_id and permission_id required" }, 400);

      // Check if role exists
      const roleCheck = await db`SELECT id FROM roles WHERE id = ${role_id}`;
      if (roleCheck.length === 0) {
        return withCors(req, { success: false, error: "Role ID does not exist" }, 404);
      }

      // Check if permission exists
      const permCheck = await db`SELECT id FROM permissions WHERE id = ${permission_id}`;
      if (permCheck.length === 0) {
        return withCors(req, { success: false, error: "Permission ID does not exist" }, 404);
      }

      await db`
        INSERT INTO role_permissions (role_id, permission_id) 
        VALUES (${role_id}, ${permission_id})
        ON CONFLICT DO NOTHING
      `;
      return withCors(req, { success: true, message: "Permission assigned to role successfully" });
    }
    // Unassign permission from role
    else if (action === "unassign_role") {
      const { role_id, permission_id } = body;
      if (!role_id || !permission_id) return withCors(req, { success: false, error: "role_id and permission_id required" }, 400);

      await db`DELETE FROM role_permissions WHERE role_id = ${role_id} AND permission_id = ${permission_id}`;
      return withCors(req, { success: true, message: "Permission removed from role successfully" });
    }

    // Default: Create new permission
    const { name, resource, action: permAction, description } = body;
    if (!name || !resource || !permAction) {
      return withCors(req, { success: false, error: "name, resource, and action are required" }, 400);
    }

    const result = await db`
      INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
      VALUES (${name}, ${resource}, ${permAction}, ${description || null}, NOW(), NOW())
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Permission created successfully",
      data: result[0]
    });
  } catch (error: any) {
    console.error("CREATE PERMISSION ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to process permission request" }, 500);
  }
}

// ---------------- READ PERMISSIONS ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const userId = searchParams.get("user_id");
    const roleId = searchParams.get("role_id");

    if (id) {
      const perm = await db`SELECT * FROM permissions WHERE id = ${id}`;
      if (!perm[0]) return withCors(req, { success: false, error: "Permission not found" }, 404);
      return withCors(req, { success: true, data: perm[0] });
    }

    if (userId) {
      // Get permissions for a specific user (both direct and via roles)
      const perms = await db`
        SELECT DISTINCT p.* FROM permissions p
        LEFT JOIN user_permissions up ON p.id = up.permission_id AND up.user_id = ${userId}
        LEFT JOIN role_permissions rp ON p.id = rp.permission_id
        LEFT JOIN user_roles ur ON rp.role_id = ur.role_id AND ur.user_id = ${userId}
        WHERE up.user_id IS NOT NULL OR ur.user_id IS NOT NULL
      `;
      return withCors(req, { success: true, data: perms });
    }

    if (roleId) {
      const perms = await db`
        SELECT p.* FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = ${roleId}
      `;
      return withCors(req, { success: true, data: perms });
    }

    const permissions = await db`SELECT * FROM permissions ORDER BY id ASC`;
    return withCors(req, { success: true, data: permissions });
  } catch (error: any) {
    console.error("GET PERMISSIONS ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch permissions" }, 500);
  }
}

// ---------------- UPDATE PERMISSION ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { id, name, resource, action, description } = body;

    if (!id) return withCors(req, { success: false, error: "Permission id is required" }, 400);

    const existing = await db`SELECT * FROM permissions WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Permission not found" }, 404);

    const newName = name ?? existing[0].name;
    const newResource = resource ?? existing[0].resource;
    const newAction = action ?? existing[0].action;
    const newDesc = description !== undefined ? description : existing[0].description;

    const updated = await db`
      UPDATE permissions 
      SET name = ${newName}, resource = ${newResource}, action = ${newAction}, description = ${newDesc}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `;

    return withCors(req, { success: true, message: "Permission updated", data: updated[0] });
  } catch (error: any) {
    console.error("UPDATE PERMISSION ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to update permission" }, 500);
  }
}

// ---------------- DELETE PERMISSION ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, error: "Permission id is required" }, 400);

    const existing = await db`SELECT * FROM permissions WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Permission not found" }, 404);

    await db`DELETE FROM permissions WHERE id = ${id}`;
    return withCors(req, { success: true, message: "Permission deleted successfully" });
  } catch (error: any) {
    console.error("DELETE PERMISSION ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to delete permission" }, 500);
  }
}
