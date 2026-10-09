import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import bcrypt from "bcryptjs";
import {
  requirePermission,
  can,
  covers,
  loadGrants,
  runAudited,
  readReason,
  type AuthContext,
} from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const MANAGE = "users.accounts.manage";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * An account may only be managed by someone whose scope contains every scope
 * the account holds access in, and privileged accounts need access.privileged.grant.
 * Without this, resetting a more powerful account's password would be a takeover.
 */
async function manageError(ctx: AuthContext, targetId: string): Promise<string | null> {
  const grants = await loadGrants(targetId);

  if (grants.some((g) => g.privileged) && !can(ctx, "access.privileged.grant")) {
    return "This account holds privileged access and needs access.privileged.grant to manage";
  }
  if (!grants.every((g) => covers(ctx, MANAGE, g))) {
    return "This account holds access outside your organisational scope";
  }
  return null;
}

// ---------------- CREATE ADMIN USER ----------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

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
    const activeStatus = is_active !== undefined ? Boolean(is_active) : true;

    // A new account has no roles, so it has no access until one is assigned via /api/roles
    const [result] = await runAudited(
      req,
      auth.ctx,
      { action: "users.account.created", targetType: "user", targetId: username, reason: readReason(body.reason), details: { email, full_name } },
      [
        db`
          INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active, status, created_at, updated_at)
          VALUES (${username}, ${email}, ${password_hash}, ${full_name}, ${userRole}, ${activeStatus}, ${activeStatus ? "active" : "deactivated"}, NOW(), NOW())
          RETURNING id, username, email, full_name, role, is_active, status, created_at
        `,
      ]
    );

    return withCors(req, {
      success: true,
      message: "Admin user created successfully",
      data: result?.[0]
    });
  } catch (error: any) {
    console.error("CREATE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to create admin user" }, 500);
  }
}

// ---------------- READ ADMIN USERS ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "users.accounts.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const user = await db`
        SELECT id, username, email, full_name, role, is_active, status, last_login, created_at, updated_at
        FROM admin_users WHERE id = ${id}
      `;
      if (!user[0]) return withCors(req, { success: false, error: "User not found" }, 404);
      return withCors(req, { success: true, data: user[0] });
    }

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const users = await db`
      SELECT id, username, email, full_name, role, is_active, status, last_login, created_at
      FROM admin_users
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalRes = await db`SELECT COUNT(*) FROM admin_users`;
    const total = Number(totalRes?.[0]?.count ?? 0);

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
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json()) as any;
    const { id, username, email, full_name, role, is_active, status, password } = body;

    if (!id) return withCors(req, { success: false, error: "User id is required" }, 400);

    const existing = await db`SELECT * FROM admin_users WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "User not found" }, 404);

    if (status !== undefined && !["active", "suspended", "deactivated"].includes(status)) {
      return withCors(req, { success: false, error: "status must be active, suspended or deactivated" }, 400);
    }

    const scopeError = await manageError(ctx, String(existing[0].id));
    if (scopeError) return withCors(req, { success: false, error: scopeError }, 403);

    const newUsername = username ?? existing[0].username;
    const newEmail = email ?? existing[0].email;
    const newFullName = full_name ?? existing[0].full_name;
    const newRole = role ?? existing[0].role;

    // status is the lifecycle state; is_active is what login checks
    let newStatus: string = existing[0].status;
    if (status !== undefined) newStatus = status;
    else if (is_active !== undefined) newStatus = is_active ? "active" : "deactivated";
    const newIsActive = newStatus === "active";

    const statusChanged = newStatus !== existing[0].status;
    const sensitive =
      statusChanged || Boolean(password) || newRole !== existing[0].role || newEmail !== existing[0].email;
    const reason = readReason(body.reason);

    if (sensitive && !reason) {
      return withCors(req, { success: false, error: "reason is required for this change" }, 400);
    }
    if (String(existing[0].id) === ctx.userId && (statusChanged || newRole !== existing[0].role)) {
      return withCors(req, { success: false, error: "You cannot change your own status or role" }, 403);
    }

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

    // Tokens issued before a suspension, deactivation or password change stop working
    const revokeSessions = Boolean(password) || (statusChanged && !newIsActive);

    const [updated] = await runAudited(
      req,
      ctx,
      {
        action: statusChanged ? `users.account.${newStatus === "active" ? "reactivated" : newStatus}` : "users.account.updated",
        targetType: "user",
        targetId: id,
        reason,
        details: {
          username: newUsername,
          status: newStatus,
          password_changed: Boolean(password),
          email_changed: newEmail !== existing[0].email,
          legacy_role: newRole,
        },
      },
      [
        db`
          UPDATE admin_users SET
            username = ${newUsername},
            email = ${newEmail},
            full_name = ${newFullName},
            role = ${newRole},
            is_active = ${newIsActive},
            status = ${newStatus},
            password_hash = ${newPasswordHash},
            sessions_valid_after = CASE WHEN ${revokeSessions} THEN NOW() ELSE sessions_valid_after END,
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, username, email, full_name, role, is_active, status, updated_at
        `,
      ]
    );

    return withCors(req, { success: true, message: "User updated successfully", data: updated?.[0] });
  } catch (error: any) {
    console.error("UPDATE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to update admin user" }, 500);
  }
}

// ---------------- DELETE ADMIN USER ----------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, error: "User id is required" }, 400);

    const reason = readReason(searchParams.get("reason"));
    if (!reason) return withCors(req, { success: false, error: "reason is required" }, 400);

    const existing = await db`SELECT id, username FROM admin_users WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "User not found" }, 404);

    const targetId = String(existing[0].id);
    if (targetId === ctx.userId) {
      return withCors(req, { success: false, error: "You cannot delete your own account" }, 403);
    }

    const scopeError = await manageError(ctx, targetId);
    if (scopeError) return withCors(req, { success: false, error: scopeError }, 403);

    // user_roles / user_permissions have no foreign key to admin_users, so clear them here
    await runAudited(
      req,
      ctx,
      { action: "users.account.deleted", targetType: "user", targetId, reason, details: { username: existing[0].username } },
      [
        db`DELETE FROM user_roles WHERE user_id = ${targetId}`,
        db`DELETE FROM user_permissions WHERE user_id = ${targetId}`,
        db`DELETE FROM admin_users WHERE id = ${id}`,
      ]
    );

    return withCors(req, { success: true, message: "Admin user deleted successfully" });
  } catch (error: any) {
    console.error("DELETE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to delete admin user" }, 500);
  }
}
