import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// POST: Disapprove pending employee
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

    console.log("🔄 Disapproving employee:", registrationId)

    // Check if pending employee exists
    const pending = await sql`
      SELECT * FROM pending_employees
      WHERE registration_id = ${registrationId}
    `

    if (!pending || pending.length === 0) {
      return withCors(req, {
        success: false,
        error: "Pending employee not found",
      }, 404)
    }

    // Delete from pending_employees
    await sql`
      DELETE FROM pending_employees
      WHERE registration_id = ${registrationId}
    `

    return withCors(req, {
      success: true,
      message: "Pending employee disapproved and removed successfully",
      registrationId
    })

  } catch (error) {
    console.error("❌ Error disapproving employee:", error)

    return withCors(req, {
      success: false,
      error: "Failed to disapprove employee",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}