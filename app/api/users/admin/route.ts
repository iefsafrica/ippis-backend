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
import {
  formatUserAccount,
  loadUserRolesMap,
  normalizeScopeToBackend,
  UserRoleRecord,
} from "@/lib/user-management";
import { sendEmployeeCredentialsEmail } from "@/lib/email";
import { checkRoleAssignment, scopeFromRequest } from "@/lib/role-grants";
import { generateTemporaryPassword, validatePasswordStrength } from "@/lib/password-utils";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const MANAGE = "users.accounts.manage";
const VIEW = "users.accounts.view";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * An account may only be managed by someone whose scope contains every scope
 * the account holds access in, and privileged accounts need access.privileged.grant.
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

// Helper to fetch all active roles as fallback list
async function getAllRoles(): Promise<UserRoleRecord[]> {
  const rows = await db`SELECT id, name, description, key, default_scope FROM roles WHERE status = 'active' ORDER BY id ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    description: r.description ? String(r.description) : null,
    key: r.key ? String(r.key) : null,
    scope_level: r.default_scope ? String(r.default_scope) : null,
  }));
}

// ---------------- READ ADMIN USERS ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    const search = searchParams.get("search")?.toLowerCase().trim();
    const roleParam = searchParams.get("role");
    const statusParam = searchParams.get("status");
    const mdaParam = searchParams.get("mda_id");
    const deptParam = searchParams.get("department_id");

    const allRoles = await getAllRoles();

    // Single User Lookup
    if (idParam) {
      const rows = await db`
        SELECT u.id, u.username, u.email, u.full_name, u.staff_id, u.phone,
               u.role, u.is_active, u.status, u.mda_id, u.department_id,
               u.scope_level, u.notes, u.last_login, u.created_at, u.updated_at,
               c.name AS mda_name, d.name AS department_name
        FROM admin_users u
        LEFT JOIN companies c ON c.id = u.mda_id
        LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = ${idParam}
      `;
      if (!rows[0]) return withCors(req, { success: false, error: "User not found" }, 404);

      const rolesMap = await loadUserRolesMap([rows[0].id]);
      const formatted = formatUserAccount(rows[0], rolesMap[String(rows[0].id)] || [], allRoles);
      return withCors(req, { success: true, data: formatted });
    }

    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || "50") || 50));
    const offset = (page - 1) * limit;

    // Filter conditions for SQL
    const statusFilter = statusParam && statusParam !== "all" ? statusParam : null;
    const mdaIdFilter = mdaParam && mdaParam !== "all" && !isNaN(Number(mdaParam)) ? Number(mdaParam) : null;
    const deptIdFilter = deptParam && deptParam !== "all" && !isNaN(Number(deptParam)) ? Number(deptParam) : null;

    let usersQuery = await db`
      SELECT u.id, u.username, u.email, u.full_name, u.staff_id, u.phone,
             u.role, u.is_active, u.status, u.mda_id, u.department_id,
             u.scope_level, u.notes, u.last_login, u.created_at, u.updated_at,
             c.name AS mda_name, d.name AS department_name
      FROM admin_users u
      LEFT JOIN companies c ON c.id = u.mda_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE (${statusFilter}::text IS NULL OR u.status = ${statusFilter} OR (${statusFilter} = 'active' AND u.is_active = TRUE AND u.status IS NULL))
        AND (${mdaIdFilter}::int IS NULL OR u.mda_id = ${mdaIdFilter})
        AND (${deptIdFilter}::int IS NULL OR u.department_id = ${deptIdFilter})
      ORDER BY u.id DESC
    `;

    // Fetch user roles map for all retrieved users
    const userIds = usersQuery.map((u) => u.id);
    const rolesMap = await loadUserRolesMap(userIds);

    let formattedUsers = usersQuery.map((u) =>
      formatUserAccount(u, rolesMap[String(u.id)] || [], allRoles)
    );

    // Filter by search string if provided
    if (search) {
      formattedUsers = formattedUsers.filter(
        (u) =>
          u.full_name.toLowerCase().includes(search) ||
          u.username.toLowerCase().includes(search) ||
          u.email.toLowerCase().includes(search) ||
          u.staff_id.toLowerCase().includes(search)
      );
    }

    // Filter by role if provided
    if (roleParam && roleParam !== "all") {
      formattedUsers = formattedUsers.filter((u) =>
        u.roles.some(
          (r) =>
            String(r.id) === String(roleParam) ||
            r.name.toLowerCase() === roleParam.toLowerCase() ||
            (r.key && r.key.toLowerCase() === roleParam.toLowerCase())
        )
      );
    }

    const total = formattedUsers.length;
    const paginated = formattedUsers.slice(offset, offset + limit);

    return withCors(req, {
      success: true,
      data: {
        users: paginated,
        total,
        pagination: { total, page, limit },
      },
    });
  } catch (error: any) {
    console.error("GET ADMIN USERS ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch admin users" }, 500);
  }
}

// ---------------- CREATE ADMIN USER ----------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") {
      return withCors(req, { success: false, error: "Send the request body as valid JSON" }, 400);
    }
    const {
      username,
      email,
      password,
      full_name,
      staff_id,
      phone,
      role_ids,
      mda_id,
      department_id,
      scope_level,
      status,
      notes,
    } = body;

    if (!username || !email || !full_name) {
      return withCors(req, { success: false, error: "username, email, and full_name are required" }, 400);
    }

    // Clean identifiers
    const cleanUsername = String(username).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanStaffId = staff_id ? String(staff_id).trim() : null;

    // Check duplicate username or email
    const existing = await db`
      SELECT id, username, email, staff_id FROM admin_users
      WHERE LOWER(username) = LOWER(${cleanUsername}) OR LOWER(email) = LOWER(${cleanEmail})
    `;
    if (existing.length > 0) {
      if (existing.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
        return withCors(req, { success: false, error: `Username '${cleanUsername}' already exists` }, 409);
      }
      return withCors(req, { success: false, error: `Email '${cleanEmail}' already exists` }, 409);
    }

    // Check duplicate staff_id
    if (cleanStaffId) {
      const existingStaff = await db`
        SELECT id FROM admin_users WHERE staff_id = ${cleanStaffId}
      `;
      if (existingStaff.length > 0) {
        return withCors(req, { success: false, error: `Staff ID '${cleanStaffId}' already exists in system` }, 409);
      }
    }

    // Where the account belongs. An MDA or department that does not exist is
    // refused; it is never swapped for another one or widened to global.
    const resolved = await scopeFromRequest(scope_level, mda_id, department_id);
    if ("error" in resolved) {
      return withCors(req, { success: false, error: resolved.error }, 400);
    }
    const scope = resolved.scope;
    if (!covers(ctx, MANAGE, scope)) {
      return withCors(req, { success: false, error: "You can only create accounts inside your organisational scope" }, 403);
    }
    const verifiedScope = { scope_level: scope.level, company_id: scope.companyId, department_id: scope.departmentId };

    // Roles go through the same checks as /api/roles: privileged roles, scope and separation of duties
    const roleIdList: number[] = Array.isArray(role_ids)
      ? role_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const roleCheck = await checkRoleAssignment(ctx, null, roleIdList, scope);
    if (!roleCheck.ok) {
      return withCors(req, { success: false, error: roleCheck.error, conflicts: roleCheck.conflicts }, roleCheck.status);
    }

    // A password typed by the administrator must be strong; otherwise a random
    // one-off password is generated and emailed to the user
    if (password) {
      const strength = validatePasswordStrength(String(password));
      if (!strength.valid) return withCors(req, { success: false, error: strength.message }, 400);
    }
    const initialPassword = password ? String(password) : generateTemporaryPassword();
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(initialPassword, salt);

    const userStatus = status || "active";
    const isActive = userStatus === "active";

    // Insert user account
    const insertedUsers = await db`
      INSERT INTO admin_users (
        username, email, password_hash, full_name, staff_id, phone,
        mda_id, department_id, scope_level, role, is_active, status, notes,
        created_at, updated_at
      )
      VALUES (
        ${cleanUsername}, ${cleanEmail}, ${password_hash}, ${full_name}, ${cleanStaffId}, ${phone || null},
        ${verifiedScope.company_id}, ${verifiedScope.department_id}, ${verifiedScope.scope_level}, 'admin', ${isActive}, ${userStatus}, ${notes || null},
        NOW(), NOW()
      )
      RETURNING *
    `;

    const newUser = insertedUsers[0];
    if (!newUser) {
      return withCors(req, { success: false, error: "Failed to create user account" }, 500);
    }
    const newUserId = Number(newUser.id);

    // If staff_id was not provided, auto-assign default
    if (!cleanStaffId) {
      const autoStaffId = `IPPIS-STAFF-${1000 + newUserId}`;
      await db`UPDATE admin_users SET staff_id = ${autoStaffId} WHERE id = ${newUserId}`;
      newUser.staff_id = autoStaffId;
    }

    // Assign roles in user_roles (already checked above)
    for (const rId of roleIdList) {
      await db`
        INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, assigned_by, reason)
        VALUES (${String(newUserId)}, ${rId}, ${verifiedScope.scope_level}, ${verifiedScope.company_id}, ${verifiedScope.department_id}, ${ctx.userId}, ${notes || "Initial account creation"})
        ON CONFLICT DO NOTHING
      `;
    }

    // Run audit logging
    await runAudited(
      req,
      ctx,
      {
        action: "CREATE_USER",
        targetType: "user",
        targetId: newUserId,
        reason: notes || "Authorized initial account creation workflow",
        details: {
          username: cleanUsername,
          email: cleanEmail,
          full_name,
          staff_id: newUser.staff_id,
          role_ids: roleIdList,
          mda_id: verifiedScope.company_id,
          department_id: verifiedScope.department_id,
          scope_level: verifiedScope.scope_level,
        },
      },
      []
    );

    // Return enriched user format
    const allRoles = await getAllRoles();
    const rolesMap = await loadUserRolesMap([newUserId]);
    const formatted = formatUserAccount(newUser, rolesMap[String(newUserId)] || [], allRoles);

    // Send credential login email with HTML formatting to employee/user
    const primaryRole = allRoles.find((r) => roleIdList.includes(r.id))?.name || "Officer / User";
    const mdaRow = verifiedScope.company_id
      ? (await db`SELECT name FROM companies WHERE id = ${verifiedScope.company_id}`)[0]
      : null;
    const deptRow = verifiedScope.department_id
      ? (await db`SELECT name FROM departments WHERE id = ${verifiedScope.department_id}`)[0]
      : null;

    sendEmployeeCredentialsEmail({
      to: cleanEmail,
      fullName: full_name,
      username: cleanUsername,
      temporaryPassword: initialPassword,
      staffId: newUser.staff_id,
      roleName: primaryRole,
      mdaName: mdaRow?.name || undefined,
      departmentName: deptRow?.name || undefined,
      loginUrl: `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/login`,
    }).catch((emailErr) => {
      console.error("Failed to send welcome credentials email:", emailErr);
    });

    return withCors(req, {
      success: true,
      message: "Admin user created successfully",
      data: formatted,
    });
  } catch (error: any) {
    console.error("CREATE ADMIN USER ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to create admin user" }, 500);
  }
}

// ---------------- UPDATE ADMIN USER ----------------
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") {
      return withCors(req, { success: false, error: "Send the request body as valid JSON" }, 400);
    }
    const {
      id,
      username,
      email,
      full_name,
      staff_id,
      phone,
      status,
      is_active,
      password,
      role_ids,
      mda_id,
      department_id,
      scope_level,
      notes,
    } = body;

    if (!id) return withCors(req, { success: false, error: "User id is required" }, 400);

    const existingRows = await db`SELECT * FROM admin_users WHERE id = ${id}`;
    const existing = existingRows[0];
    if (!existing) return withCors(req, { success: false, error: "User not found" }, 404);

    const targetIdStr = String(existing.id);
    const scopeError = await manageError(ctx, targetIdStr);
    if (scopeError) return withCors(req, { success: false, error: scopeError }, 403);

    // Where the account belongs after this change. Only validated when the request
    // touches it, so editing a name or phone number keeps the stored scope as it is.
    const scopeTouched = scope_level !== undefined || mda_id !== undefined || department_id !== undefined;
    let validPatchScope = {
      scope_level: existing.scope_level ?? null,
      company_id: existing.mda_id == null ? null : Number(existing.mda_id),
      department_id: existing.department_id == null ? null : Number(existing.department_id),
    };
    if (scopeTouched) {
      const resolved = await scopeFromRequest(
        scope_level !== undefined ? scope_level : existing.scope_level,
        mda_id !== undefined ? mda_id : existing.mda_id,
        department_id !== undefined ? department_id : existing.department_id
      );
      if ("error" in resolved) {
        return withCors(req, { success: false, error: resolved.error }, 400);
      }
      validPatchScope = {
        scope_level: resolved.scope.level,
        company_id: resolved.scope.companyId,
        department_id: resolved.scope.departmentId,
      };
    }
    const newScope = {
      level: validPatchScope.scope_level ?? "self",
      companyId: validPatchScope.company_id,
      departmentId: validPatchScope.department_id,
    } as const;
    const scopeChanged =
      scopeTouched &&
      // Stored scope names may be the frontend's ("assigned_mda"); compare the backend meaning
      (validPatchScope.scope_level !== normalizeScopeToBackend(existing.scope_level) ||
        validPatchScope.company_id !== (existing.mda_id == null ? null : Number(existing.mda_id)) ||
        validPatchScope.department_id !== (existing.department_id == null ? null : Number(existing.department_id)));

    const currentRoleIds = (await db`SELECT DISTINCT role_id FROM user_roles WHERE user_id = ${targetIdStr}`)
      .map((r: any) => Number(r.role_id))
      .sort((a: number, b: number) => a - b);
    const requestedRoleIds: number[] | null = Array.isArray(role_ids)
      ? [...new Set(role_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
      : null;
    const rolesChanged = requestedRoleIds !== null && requestedRoleIds.join(",") !== currentRoleIds.join(",");

    // Nobody changes their own roles or organisational scope
    if (targetIdStr === ctx.userId && (rolesChanged || scopeChanged)) {
      return withCors(req, { success: false, error: "You cannot change your own access" }, 403);
    }
    if (scopeChanged && !covers(ctx, MANAGE, newScope)) {
      return withCors(req, { success: false, error: "You can only move accounts within your organisational scope" }, 403);
    }
    // Roles are re-saved with the account's scope, so check them when either changes
    if (requestedRoleIds !== null && (rolesChanged || scopeChanged)) {
      const roleCheck = await checkRoleAssignment(ctx, targetIdStr, requestedRoleIds, newScope, { replaceExisting: true });
      if (!roleCheck.ok) {
        return withCors(req, { success: false, error: roleCheck.error, conflicts: roleCheck.conflicts }, roleCheck.status);
      }
    }

    // Status mapping
    let newStatus = existing.status || (existing.is_active ? "active" : "deactivated");
    if (status !== undefined) {
      if (!["active", "suspended", "deactivated", "pending"].includes(status)) {
        return withCors(req, { success: false, error: "status must be active, suspended, deactivated, or pending" }, 400);
      }
      newStatus = status;
    } else if (is_active !== undefined) {
      newStatus = is_active ? "active" : "deactivated";
    }
    const newIsActive = newStatus === "active";

    const statusChanged = newStatus !== existing.status;
    const sensitive =
      statusChanged ||
      Boolean(password) ||
      (email && email !== existing.email) ||
      rolesChanged ||
      scopeChanged;

    const reason = readReason(body.reason);
    if (sensitive && !reason) {
      return withCors(req, { success: false, error: "A justification reason is required for sensitive account modifications" }, 400);
    }

    if (targetIdStr === ctx.userId && statusChanged && !newIsActive) {
      return withCors(req, { success: false, error: "You cannot suspend or deactivate your own account" }, 403);
    }

    const newUsername = username ? String(username).trim() : existing.username;
    const newEmail = email ? String(email).trim().toLowerCase() : existing.email;
    const newFullName = full_name ? String(full_name).trim() : existing.full_name;
    const newStaffId = staff_id !== undefined ? (staff_id ? String(staff_id).trim() : null) : existing.staff_id;
    const newPhone = phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone;
    const newNotes = notes !== undefined ? notes : existing.notes;

    // Check duplicate username or email or staff_id
    if (newUsername !== existing.username || newEmail !== existing.email || newStaffId !== existing.staff_id) {
      const dup = await db`
        SELECT id, username, email, staff_id FROM admin_users
        WHERE (LOWER(username) = LOWER(${newUsername}) OR LOWER(email) = LOWER(${newEmail}) OR (${newStaffId}::text IS NOT NULL AND staff_id = ${newStaffId}))
          AND id != ${id}
      `;
      if (dup.length > 0) {
        return withCors(req, { success: false, error: "Username, email, or staff ID is already taken by another user" }, 409);
      }
    }

    let newPasswordHash = existing.password_hash;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      newPasswordHash = await bcrypt.hash(password, salt);
    }

    const revokeSessions = Boolean(password) || (statusChanged && !newIsActive);

    // Update user in DB
    const updatedUsers = await db`
      UPDATE admin_users SET
        username = ${newUsername},
        email = ${newEmail},
        full_name = ${newFullName},
        staff_id = ${newStaffId},
        phone = ${newPhone},
        mda_id = ${validPatchScope.company_id},
        department_id = ${validPatchScope.department_id},
        scope_level = ${validPatchScope.scope_level},
        is_active = ${newIsActive},
        status = ${newStatus},
        password_hash = ${newPasswordHash},
        notes = ${newNotes},
        sessions_valid_after = CASE WHEN ${revokeSessions} THEN NOW() ELSE sessions_valid_after END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    // Replace role assignments (already checked above) in one transaction
    if (requestedRoleIds !== null && (rolesChanged || scopeChanged)) {
      await db.transaction([
        db`DELETE FROM user_roles WHERE user_id = ${targetIdStr}`,
        ...requestedRoleIds.map((rId) => db`
          INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, assigned_by, reason)
          VALUES (${targetIdStr}, ${rId}, ${validPatchScope.scope_level}, ${validPatchScope.company_id}, ${validPatchScope.department_id}, ${ctx.userId}, ${reason || "Role update"})
          ON CONFLICT DO NOTHING
        `),
      ]);
    }

    // Run audited log
    await runAudited(
      req,
      ctx,
      {
        action: statusChanged ? "STATUS_CHANGE" : "UPDATE_USER",
        targetType: "user",
        targetId: id,
        reason,
        details: {
          username: newUsername,
          status: newStatus,
          previous_status: existing.status,
          suspension_days: body.suspension_days || null,
          password_changed: Boolean(password),
          email_changed: newEmail !== existing.email,
          roles_updated: rolesChanged,
          scope_changed: scopeChanged,
          role_ids: requestedRoleIds ?? undefined,
        },
      },
      []
    );

    const updatedUser = updatedUsers[0];
    if (!updatedUser) {
      return withCors(req, { success: false, error: "Failed to update user account" }, 500);
    }

    const allRoles = await getAllRoles();
    const rolesMap = await loadUserRolesMap([id]);
    const formatted = formatUserAccount(updatedUser, rolesMap[targetIdStr] || [], allRoles);

    return withCors(req, { success: true, message: "User updated successfully", data: formatted });
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
