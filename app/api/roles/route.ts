import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../lib/cors";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ROLE / ASSIGN ROLE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { action } = body;

    if (action === "assign") {
      // Assign role to user
      const { user_id, role_id } = body;
      if (!user_id || !role_id) {
        return withCors(req, { success: false, error: "user_id and role_id are required" }, 400);
      }

      // Check if user exists in the employees (registrations) table
      const empCheck = await db`SELECT registration_id FROM registrations WHERE registration_id = ${user_id}`;
      if (empCheck.length === 0) {
        return withCors(req, { success: false, error: "User ID does not exist in employees table" }, 404);
      }

      await db`
        INSERT INTO user_roles (user_id, role_id) 
        VALUES (${user_id}, ${role_id})
        ON CONFLICT (user_id, role_id) DO NOTHING
      `;
      return withCors(req, { success: true, message: "Role assigned to user successfully" });
    } else if (action === "unassign") {
      // Unassign role from user
      const { user_id, role_id } = body;
      if (!user_id || !role_id) {
        return withCors(req, { success: false, error: "user_id and role_id are required" }, 400);
      }

      // Check if user exists in the employees (registrations) table
      const empCheck = await db`SELECT registration_id FROM registrations WHERE registration_id = ${user_id}`;
      if (empCheck.length === 0) {
        return withCors(req, { success: false, error: "User ID does not exist in employees table" }, 404);
      }

      await db`DELETE FROM user_roles WHERE user_id = ${user_id} AND role_id = ${role_id}`;
      return withCors(req, { success: true, message: "Role removed from user successfully" });
    }

    // Default: Create new role
    const { name, description } = body;
    if (!name) {
      return withCors(req, { success: false, error: "Role name is required" }, 400);
    }

    const result = await db`
      INSERT INTO roles (name, description, created_at, updated_at)
      VALUES (${name}, ${description || null}, NOW(), NOW())
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Role created successfully",
      data: result[0]
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

    if (roleId) {
      const role = await db`SELECT * FROM roles WHERE id = ${roleId}`;
      if (!role[0]) return withCors(req, { success: false, error: "Role not found" }, 404);
      return withCors(req, { success: true, data: role[0] });
    }

    if (userId) {
      // Get roles for a specific user
      const userRoles = await db`
        SELECT r.* FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ${userId}
      `;
      return withCors(req, { success: true, data: userRoles });
    }

    const roles = await db`SELECT * FROM roles ORDER BY id ASC`;
    return withCors(req, { success: true, data: roles });
  } catch (error: any) {
    console.error("GET ROLES ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch roles" }, 500);
  }
}

// ---------------- UPDATE ROLE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { id, name, description } = body;

    if (!id) return withCors(req, { success: false, error: "Role id is required" }, 400);

    const existing = await db`SELECT * FROM roles WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Role not found" }, 404);

    const newName = name ?? existing[0].name;
    const newDesc = description !== undefined ? description : existing[0].description;

    const updated = await db`
      UPDATE roles SET name = ${newName}, description = ${newDesc}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `;

    return withCors(req, { success: true, message: "Role updated", data: updated[0] });
  } catch (error: any) {
    console.error("UPDATE ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to update role" }, 500);
  }
}

// ---------------- DELETE ROLE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, error: "Role id is required" }, 400);

    const existing = await db`SELECT * FROM roles WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Role not found" }, 404);

    await db`DELETE FROM roles WHERE id = ${id}`;
    return withCors(req, { success: true, message: "Role deleted successfully" });
  } catch (error: any) {
    console.error("DELETE ROLE ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to delete role" }, 500);
  }
}
