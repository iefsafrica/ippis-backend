import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

// Neon client
const sql = neon(process.env.DATABASE_URL!)

// Helper: check if table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `
    return result[0]?.exists ?? false
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error)
    return false
  }
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// DELETE: Remove a pending employee
export async function DELETE(req: NextRequest) {
  try {
    // 1️⃣ Extract registration ID from URL
    const url = new URL(req.url)
    const pathParts = url.pathname.split("/")
    const registrationId = decodeURIComponent(pathParts[pathParts.length - 2] || "").trim()

    if (!registrationId) {
      return withCors(req, { success: false, error: "Registration ID is required in URL." }, 400)
    }

    // 2️⃣ Check if table exists
    const pendingExists = await tableExists("pending_employees")
    if (!pendingExists) {
      return withCors(req, { success: false, error: "pending_employees table does not exist." }, 404)
    }

    // 3️⃣ Check if pending employee exists
    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `
    const pendingEmployee = pendingEmployeeResult[0]

    if (!pendingEmployee) {
      return withCors(req, {
        success: false,
        error: `Pending employee with registration ID ${registrationId} not found.`,
      }, 404)
    }

    // 4️⃣ Delete the pending employee
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`

    // 5️⃣ Return success response
    return withCors(req, {
      success: true,
      message: `Pending employee ${registrationId} has been deleted successfully.`,
      data: {
        registration_id: registrationId,
        name: `${pendingEmployee.surname ?? ""} ${pendingEmployee.firstname ?? ""}`.trim() || "Employee",
        email: pendingEmployee.email,
      },
    })
  } catch (error) {
    console.error("Error deleting pending employee:", error)
    return withCors(req, {
      success: false,
      error: "Failed to delete pending employee.",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
