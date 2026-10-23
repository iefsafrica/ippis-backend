import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { moduleScope } from "@/lib/module-scope"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { project_ids?: (number | string)[] }
    const projectIds = body.project_ids

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of project_ids is required",
      }, 400)
    }

    // Check which projects exist, are not "empty" (have a name and manager) and are
    // inside the caller's MDA or department; the rest are skipped
    const sc = moduleScope(auth.ctx, "projects.records.approve")
    const existingProjects = await sql`
      SELECT p.id FROM projects p
      WHERE p.id = ANY(${projectIds})
      AND p.name IS NOT NULL AND p.name != ''
      AND p.manager_id IS NOT NULL
      AND (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))
    `

    const existingIds = existingProjects.map(p => p.id)
    const missingIds = projectIds.filter(id => !existingIds.includes(Number(id)))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid projects found to approve. Projects must exist and have a name and manager.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE projects
      SET status = 'approved', updated_at = NOW()
      WHERE id = ANY(${existingIds})
      RETURNING id
    `

    await runAudited(req, auth.ctx, { action: "projects.record.approved", targetType: "projects.record", details: {} }, [])

    return withCors(req, {
      success: true,
      message: `${results.length} projects approved successfully`,
      approvedIds: results.map(r => r.id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving projects:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve projects",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
