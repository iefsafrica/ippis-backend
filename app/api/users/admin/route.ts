import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../../lib/cors";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ADMIN USER ----------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { username, email, password, full_name, role, is_active } = body;

    if (!username || !email || !password || !full_name) {
      return withCors(req, { success: false, error: "username, email, password, and full_name are required" }, 400);
    }

    // Check if user already exists
    const existing = await db`SELECT id FROM admin_users WHERE username = ${username} OR email = ${email}`;
    if (existing.length > 0) {
      return withCors(req, { success: false, error: "User with this username or email already exists" }, 409);
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const userRole = role || 'admin';
    const activeStatus = is_active !== undefined ? is_active : true;

    const result = await db`
      INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (${username}, ${email}, ${password_hash}, ${full_name}, ${userRole}, ${activeStatus}, NOW(), NOW())
      RETURNING id, username, email, full_name, role, is_active, created_at
    `;

    return withCors(req, {
      success: true,
      message: "Admin user created successfully",
      data: result[0]
    });
  } catch (error: any) {
    console.error("CREATE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to create admin user" }, 500);
  }
}

// ---------------- READ ADMIN USERS ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const user = await db`
        SELECT id, username, email, full_name, role, is_active, last_login, created_at, updated_at 
        FROM admin_users WHERE id = ${id}
      `;
      if (!user[0]) return withCors(req, { success: false, error: "User not found" }, 404);
      return withCors(req, { success: true, data: user[0] });
    }

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const users = await db`
      SELECT id, username, email, full_name, role, is_active, last_login, created_at 
      FROM admin_users 
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalRes = await db`SELECT COUNT(*) FROM admin_users`;
    const total = Number(totalRes[0].count);

    return withCors(req, { 
      success: true, 
      data: {
        users,
        pagination: { total, page, limit }
      }
    });
  } catch (error: any) {
    console.error("GET ADMIN USERS ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch admin users" }, 500);
  }
}

// ---------------- UPDATE ADMIN USER ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const { id, username, email, full_name, role, is_active, password } = body;

    if (!id) return withCors(req, { success: false, error: "User id is required" }, 400);

    const existing = await db`SELECT * FROM admin_users WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "User not found" }, 404);

    const newUsername = username ?? existing[0].username;
    const newEmail = email ?? existing[0].email;
    const newFullName = full_name ?? existing[0].full_name;
    const newRole = role ?? existing[0].role;
    const newIsActive = is_active !== undefined ? is_active : existing[0].is_active;
    
    let newPasswordHash = existing[0].password_hash;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      newPasswordHash = await bcrypt.hash(password, salt);
    }

    // Check uniqueness if email or username changed
    if (newUsername !== existing[0].username || newEmail !== existing[0].email) {
      const duplicate = await db`
        SELECT id FROM admin_users 
        WHERE (username = ${newUsername} OR email = ${newEmail}) AND id != ${id}
      `;
      if (duplicate.length > 0) {
        return withCors(req, { success: false, error: "Username or email is already taken by another user" }, 409);
      }
    }

    const updated = await db`
      UPDATE admin_users SET 
        username = ${newUsername}, 
        email = ${newEmail}, 
        full_name = ${newFullName}, 
        role = ${newRole}, 
        is_active = ${newIsActive}, 
        password_hash = ${newPasswordHash},
        updated_at = NOW()
      WHERE id = ${id} 
      RETURNING id, username, email, full_name, role, is_active, updated_at
    `;

    return withCors(req, { success: true, message: "User updated successfully", data: updated[0] });
  } catch (error: any) {
    console.error("UPDATE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to update admin user" }, 500);
  }
}

// ---------------- DELETE ADMIN USER ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, error: "User id is required" }, 400);

    const existing = await db`SELECT id FROM admin_users WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "User not found" }, 404);

    await db`DELETE FROM admin_users WHERE id = ${id}`;
    return withCors(req, { success: true, message: "Admin user deleted successfully" });
  } catch (error: any) {
    console.error("DELETE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to delete admin user" }, 500);
  }
}
