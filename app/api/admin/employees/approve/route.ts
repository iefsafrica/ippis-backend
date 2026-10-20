import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { sendEmployeeApprovalEmail } from "@/lib/email"
import bcrypt from "bcryptjs"
import crypto from "crypto"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// ✅ Type for pending employee
type PendingEmployee = {
  id: string
  registration_id: string
  firstname: string
  surname: string
  email: string
  position: string
  department?: string
  status?: string
  metadata?: Record<string, any>
  created_at?: string
  updated_at?: string
}

/** Generates a secure temporary password */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  const special = "!@#$%"
  let pw = ""
  for (let i = 0; i < 8; i++) {
    pw += chars[crypto.randomInt(chars.length)]
  }
  pw += special[crypto.randomInt(special.length)]
  pw += crypto.randomInt(10, 99)
  return pw.split("").sort(() => crypto.randomInt(3) - 1).join("")
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// POST: Approve pending employee
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.registrations.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { registration_id?: string }
    const registrationId = body.registration_id

    if (!registrationId || typeof registrationId !== "string") {
      return withCors(req, {
        success: false,
        error: "Valid registration_id is required",
      }, 400)
    }

    console.log("🔄 Approving employee:", registrationId)

    // Fetch pending employee
    const pending = (await sql`
      SELECT * FROM pending_employees
      WHERE registration_id = ${registrationId}
    `) as PendingEmployee[]

    if (!pending || pending.length === 0) {
      return withCors(req, {
        success: false,
        error: "Pending employee not found",
      }, 404)
    }

    const employee = pending[0]!

    // Build full name
    const name = `${employee.firstname ?? ""} ${employee.surname ?? ""}`.trim()
    const email = employee.email
    const position = employee.position
    const department = employee.department ?? null

    if (!name || !email || !position) {
      return withCors(req, {
        success: false,
        error: "Pending employee missing required fields",
      }, 400)
    }

    // ✅ Use registration_id from request as the new employees.id
    const employeeId = registrationId

    // Prevent duplicate emails
    const existing = await sql`
      SELECT id FROM employees WHERE email = ${email}
    `
    if (existing.length > 0) {
      return withCors(req, {
        success: false,
        error: "Employee with this email already exists",
      }, 409)
    }

    // Insert into employees
    await sql`
      INSERT INTO employees (
        id,
        registration_id,
        name,
        email,
        position,
        department,
        status,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${employeeId},
        ${employee.registration_id},
        ${name},
        ${email},
        ${position},
        ${department},
        'active',
        ${employee.metadata ? JSON.stringify(employee.metadata) : "{}"},
        NOW(),
        NOW()
      )
    `

    // Delete from pending
    await sql`
      DELETE FROM pending_employees
      WHERE registration_id = ${registrationId}
    `

    // Create admin_users login account for the employee
    let temporaryPassword: string | undefined
    try {
      temporaryPassword = generateTempPassword()
      const passwordHash = await bcrypt.hash(temporaryPassword, 12)

      await sql`
        INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active, status, staff_id, created_at, updated_at)
        VALUES (
          ${email},
          ${email},
          ${passwordHash},
          ${name},
          'employee',
          true,
          'active',
          ${employeeId},
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
      `

      // Assign the 'employee' role in user_roles
      const employeeRoleRows = await sql`SELECT id FROM roles WHERE key = 'employee' LIMIT 1`
      const adminUserRows = await sql`SELECT id FROM admin_users WHERE email = ${email} LIMIT 1`
      if (employeeRoleRows.length > 0 && adminUserRows.length > 0) {
        const roleId = (employeeRoleRows[0] as any).id
        const adminUserId = String((adminUserRows[0] as any).id)
        await sql`
          INSERT INTO user_roles (user_id, role_id, scope_level, assigned_by, reason, assigned_at)
          VALUES (${adminUserId}, ${roleId}, 'self', ${String(auth.ctx.userId)}, 'Auto-assigned on employee approval', NOW())
          ON CONFLICT DO NOTHING
        `
      }
    } catch (accountErr) {
      console.error("Failed to create employee login account:", accountErr)
      // Continue — account creation failure should not block approval
    }

    // Send approval + credentials email
    if (email) {
      sendEmployeeApprovalEmail({
        to: email,
        fullName: name,
        employeeId,
        position: position || undefined,
        department: department || undefined,
        username: email,
        temporaryPassword,
      }).catch((err) => {
        console.error("Employee approval email send failed:", err)
      })
    }

    await runAudited(req, auth.ctx, {
      action: "employees.registration.approved",
      targetType: "registration",
      targetId: registrationId,
      details: { employeeId },
    }, [])

    return withCors(req, {
      success: true,
      message: "Employee approved successfully",
      employeeId
    })

  } catch (error) {
    console.error("❌ Error approving employee:", error)

    return withCors(req, {
      success: false,
      error: "Failed to approve employee",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
