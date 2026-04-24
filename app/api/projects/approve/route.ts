import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { project_ids?: (number | string)[] }
    const projectIds = body.project_ids

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of project_ids is required",
      }, 400)
    }

    // Check which projects exist and are not "empty" (have a name and manager)
    const existingProjects = await sql`
      SELECT id FROM projects 
      WHERE id = ANY(${projectIds}) 
      AND name IS NOT NULL AND name != ''
      AND manager_id IS NOT NULL
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
