import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

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
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { registration_ids?: string[] }
    const registrationIds = body.registration_ids

    if (!registrationIds || !Array.isArray(registrationIds) || registrationIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of registration_ids is required",
      }, 400)
    }

    const results = {
      success: [] as string[],
      failed: [] as { id: string; error: string }[],
    }

    for (const registrationId of registrationIds) {
      try {
        // Fetch pending employee
        const pending = (await sql`
          SELECT * FROM pending_employees
          WHERE registration_id = ${registrationId}
        `) as PendingEmployee[]

        if (!pending || pending.length === 0) {
          results.failed.push({ id: registrationId, error: "Pending employee not found" })
          continue
        }

        const employee = pending[0]!
        const name = `${employee.firstname ?? ""} ${employee.surname ?? ""}`.trim()
        const email = employee.email
        const position = employee.position
        const department = employee.department ?? null

        if (!name || !email || !position) {
          results.failed.push({ id: registrationId, error: "Missing required fields" })
          continue
        }

        // Prevent duplicate emails
        const existing = await sql`
          SELECT id FROM employees WHERE email = ${email}
        `
        if (existing.length > 0) {
          results.failed.push({ id: registrationId, error: "Employee with this email already exists" })
          continue
        }

        // Insert into employees
        // Note: We use registrationId as the employee id for consistency with the single approve endpoint
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
            ${registrationId},
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

        results.success.push(registrationId)
      } catch (err: any) {
        results.failed.push({ id: registrationId, error: err.message })
      }
    }

    return withCors(req, {
      success: true,
      message: `Bulk approval processed: ${results.success.length} successful, ${results.failed.length} failed`,
      results
    })

  } catch (error) {
    console.error("❌ Error in bulk approval:", error)
    return withCors(req, {
      success: false,
      error: "Failed to process bulk approval",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
