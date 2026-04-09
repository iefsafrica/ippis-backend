import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

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

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// POST: Approve pending employee
export async function POST(req: NextRequest) {
  try {
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
        NOW(),
        NOW()
      )
    `

    // Delete from pending
    await sql`
      DELETE FROM pending_employees
      WHERE registration_id = ${registrationId}
    `

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