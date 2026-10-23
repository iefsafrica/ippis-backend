import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/rbac"
import { recordScope } from "@/lib/mda-scope"

export const dynamic = "force-dynamic"

// Create Neon client
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

// Helper: format date fields safely
function formatDateFields(rows: any[]) {
  return rows.map((row) => {
    const formattedRow = { ...row }
    const formatDate = (field: string, newField?: string) => {
      if (!formattedRow[field]) return
      try {
        const date = new Date(formattedRow[field])
        if (isNaN(date.getTime())) {
          formattedRow[field] = null
          if (newField) formattedRow[newField] = null
        } else if (newField) {
          formattedRow[newField] = date.toISOString()
        }
      } catch {
        formattedRow[field] = null
        if (newField) formattedRow[newField] = null
      }
    }

    formatDate("submissionDate")
    formatDate("created_at", "createdAt")
    formatDate("updated_at", "updatedAt")

    return formattedRow
  })
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// GET: List all pending employees
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.registrations.view")
    if (!auth.ok) return auth.response

    console.log(" Fetching all pending employees...")

    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get("page") || "1")
    const limit = Number(searchParams.get("limit") || "10")
    const offset = (page - 1) * limit
    // A registration belongs to the MDA chosen on its form; those without one
    // are visible with rights across all MDAs only
    const sc = recordScope(auth.ctx, "employees.registrations.view")

    // Ensure table exists
    const exists = await tableExists("pending_employees")
    if (!exists) {
      return withCors(req, {
        success: false,
        error: "The 'pending_employees' table does not exist in the database.",
      }, 404)
    }

    //  Fetch paginated rows correctly
    const rows = await sql`
      SELECT p.*, ei.company_id AS mda_id, c.name AS mda_name, ei.department_id
      FROM pending_employees p
      LEFT JOIN employment_info ei ON ei.registration_id = p.registration_id
      LEFT JOIN companies c ON c.id = ei.company_id
      WHERE (${sc.all}::boolean OR ei.company_id = ANY(${sc.companyIds}::int[]) OR ei.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    console.log("Rows fetched:", rows.length)

    const formattedRows = formatDateFields(rows)

    //  Get total count
    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM pending_employees p
      LEFT JOIN employment_info ei ON ei.registration_id = p.registration_id
      WHERE (${sc.all}::boolean OR ei.company_id = ANY(${sc.companyIds}::int[]) OR ei.department_id = ANY(${sc.departmentIds}::int[]))
    `
    const total = Number(countResult[0]?.total ?? 0)

    return withCors(req, {
      success: true,
      data: {
        employees: formattedRows,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error(" Error fetching pending employees:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch pending employees from database.",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
