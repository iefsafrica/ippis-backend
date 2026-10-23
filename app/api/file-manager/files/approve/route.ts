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
    const auth = await requirePermission(req, "files.records.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { file_ids?: string[] }
    const fileIds = body.file_ids

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of file_ids is required",
      }, 400)
    }

    // Only files of the caller's MDA or department; files for everyone (no MDA) need
    // rights across all MDAs. The rest are skipped.
    const sc = moduleScope(auth.ctx, "files.records.approve")
    const existing = await sql`
      SELECT f.file_id FROM file_manager_files f
      WHERE f.file_id = ANY(${fileIds})
      AND f.file_url IS NOT NULL AND f.file_url != ''
      AND (${sc.all}::boolean OR f.company_id = ANY(${sc.companyIds}::int[]) OR f.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND f.company_id IS NULL))
    `
    const existingIds = existing.map(r => r.file_id)
    const missingIds = fileIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid files found to approve. Files must have a URL.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE file_manager_files
      SET status = 'Approved', updated_at = NOW()
      WHERE file_id = ANY(${existingIds})
      RETURNING file_id
    `

    await runAudited(req, auth.ctx, { action: "files.record.approved", targetType: "files.record", details: {} }, [])

    return withCors(req, {
      success: true,
      message: `${results.length} files approved successfully`,
      approvedFileIds: results.map(r => r.file_id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving files:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve files",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
