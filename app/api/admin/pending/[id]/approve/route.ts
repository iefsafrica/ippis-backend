import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { sendEmployeeApprovalEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

async function tableExists(tableName: string) {
  const result = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = ${tableName}
    )
  `;
  return result[0]?.exists ?? false;
}

/** Generates a secure temporary password */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const special = "!@#$%";
  let pw = "";
  for (let i = 0; i < 8; i++) {
    pw += chars[crypto.randomInt(chars.length)];
  }
  pw += special[crypto.randomInt(special.length)];
  pw += crypto.randomInt(10, 99);
  // Shuffle
  return pw.split("").sort(() => crypto.randomInt(3) - 1).join("");
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.registrations.approve");
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const registrationId = decodeURIComponent(
      url.pathname.split("/").reverse()[1] ?? ""
    ).trim();

    if (!registrationId) {
      return withCors(
        req,
        { success: false, error: "Registration ID is required." },
        400
      );
    }

    // Ensure required tables exist
    const [pendingExists, employeesExists] = await Promise.all([
      tableExists("pending_employees"),
      tableExists("employees"),
    ]);

    if (!pendingExists || !employeesExists) {
      return withCors(
        req,
        { success: false, error: "Required tables do not exist." },
        500
      );
    }

    // Check if already migrated
    const alreadyExistingEmployee = await sql`
      SELECT * FROM employees WHERE registration_id = ${registrationId}
    `;

    if (alreadyExistingEmployee.length > 0) {
      return withCors(
        req,
        {
          success: false,
          message: "This employee has already been approved.",
          employee: alreadyExistingEmployee[0],
        },
        409
      );
    }

    // Fetch pending employee
    const existingPending = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;

    const pending = existingPending[0];
    if (!pending) {
      return withCors(
        req,
        { success: false, error: `No pending employee found for ${registrationId}.` },
        404
      );
    }

    const fullName =
      `${pending.surname ?? ""} ${pending.firstname ?? ""}`.trim() ||
      pending.name ||
      "Unnamed Employee";

    const newEmployeeId = `IPPIS${Math.floor(
      100000 + Math.random() * 900000
    )}`;

    // Insert employee and save metadata as JSONB
    const [insertedEmployee] = await sql`
      INSERT INTO employees (
        id, registration_id, name, email, position, department, status,
        metadata, join_date, created_at, updated_at
      )
      VALUES (
        ${newEmployeeId},
        ${pending.registration_id},
        ${fullName},
        ${pending.email || "no-email@example.com"},
        ${pending.position || "Not Assigned"},
        ${pending.department || "Unassigned"},
        'active',
        ${pending.metadata ? JSON.stringify(pending.metadata) : "{}"},
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    // Create admin_users login account for the employee
    let temporaryPassword: string | undefined;
    try {
      if (insertedEmployee?.email && insertedEmployee.email !== "no-email@example.com") {
        temporaryPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 12);
        const username = insertedEmployee.email;

        // Upsert admin_users: create or update if already exists
        await sql`
          INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active, status, staff_id, created_at, updated_at)
          VALUES (
            ${username},
            ${insertedEmployee.email},
            ${passwordHash},
            ${fullName},
            'employee',
            true,
            'active',
            ${newEmployeeId},
            NOW(),
            NOW()
          )
          ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            full_name = EXCLUDED.full_name,
            role = 'employee',
            is_active = true,
            status = 'active',
            staff_id = EXCLUDED.staff_id,
            updated_at = NOW()
        `;

        // Assign the 'employee' role in user_roles using the role key
        const employeeRoleRows = await sql`
          SELECT id FROM roles WHERE key = 'employee' LIMIT 1
        `;
        const adminUserRows = await sql`
          SELECT id FROM admin_users WHERE email = ${insertedEmployee.email} LIMIT 1
        `;
        if (employeeRoleRows.length > 0 && adminUserRows.length > 0) {
          const roleId = (employeeRoleRows[0] as any).id;
          const adminUserId = String((adminUserRows[0] as any).id);
          await sql`
            INSERT INTO user_roles (user_id, role_id, scope_level, assigned_by, reason, assigned_at)
            VALUES (${adminUserId}, ${roleId}, 'self', ${String(auth.ctx.userId)}, 'Auto-assigned on employee approval', NOW())
            ON CONFLICT DO NOTHING
          `;
        }
      }
    } catch (accountErr) {
      console.error("Failed to create employee login account:", accountErr);
      // Continue — account creation failure should not block approval
    }

    // Send official HTML employment approval + credentials email
    if (insertedEmployee?.email && insertedEmployee.email !== "no-email@example.com") {
      await sendEmployeeApprovalEmail({
        to: insertedEmployee.email,
        fullName,
        employeeId: insertedEmployee.id,
        position: insertedEmployee.position || undefined,
        department: insertedEmployee.department || undefined,
        username: insertedEmployee.email,
        temporaryPassword,
      }).catch((err) => {
        console.error("Employee approval email send failed:", err);
      });
    }

    // DELETE from pending_employees AFTER successful migration
    await sql`
      DELETE FROM pending_employees WHERE registration_id = ${registrationId}
    `;

    await runAudited(req, auth.ctx, {
      action: "employees.registration.approved",
      targetType: "registration",
      targetId: registrationId,
      details: {},
    }, []);

    return withCors(req, {
      success: true,
      message: "Employee approved, migrated, and removed from pending list.",
      data: insertedEmployee,
    });

  } catch (error) {
    console.error("Approval failed:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Employee approval failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
