import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/rbac"
import { recordScope } from "@/lib/mda-scope"

export const dynamic = "force-dynamic"
const sql = neon(process.env.DATABASE_URL!)

// Handle preflight request
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest)
}

// GET /api/admin/documents/stats
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.view")
    if (!auth.ok) return auth.response

    // Count documents by status
    const sc = recordScope(auth.ctx, "employees.documents.view")
    const result = await sql`
      SELECT 
        du.status,
        COUNT(*) AS total
      FROM document_uploads du
      LEFT JOIN employees emp ON emp.registration_id = du.registration_id
      LEFT JOIN employment_info ei ON ei.registration_id = du.registration_id
      WHERE du.status IN ('verified', 'approved')
        AND (${sc.all}::boolean OR COALESCE(emp.company_id, ei.company_id) = ANY(${sc.companyIds}::int[]) OR COALESCE(emp.department_id, ei.department_id) = ANY(${sc.departmentIds}::int[]))
      GROUP BY du.status
    `

    // Calculate totals
    const verifiedCount =
      result.find((r) => r.status === "verified")?.total ?? 0
    const approvedCount =
      result.find((r) => r.status === "approved")?.total ?? 0
    const total = verifiedCount + approvedCount

    return withCors(req as unknown as NextRequest, {
      success: true,
      data: {
        verified: Number(verifiedCount),
        approved: Number(approvedCount),
        total: Number(total),
      },
    })
  } catch (error) {
    console.error("Error fetching document stats:", error)
    return withCors(
      req as unknown as NextRequest,
      {
        success: false,
        error: "Failed to fetch document stats.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}
