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
    const auth = await requirePermission(req, "assets.records.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { asset_ids?: string[] }
    const assetIds = body.asset_ids

    if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of asset_ids is required",
      }, 400)
    }

    // Only assets of the caller's MDA or department; the rest are skipped
    const sc = moduleScope(auth.ctx, "assets.records.approve")
    const existing = await sql`
      SELECT a.asset_id FROM assets a
      WHERE a.asset_id = ANY(${assetIds})
      AND a.asset_name IS NOT NULL AND a.asset_name != ''
      AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
    `
    const existingIds = existing.map(r => r.asset_id)
    const missingIds = assetIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid assets found to approve. Assets must have a name.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE assets
      SET status = 'Approved', updated_at = NOW()
      WHERE asset_id = ANY(${existingIds})
      RETURNING asset_id
    `

    await runAudited(req, auth.ctx, { action: "assets.record.approved", targetType: "assets.record", details: {} }, [])

    return withCors(req, {
      success: true,
      message: `${results.length} assets approved successfully`,
      approvedAssetIds: results.map(r => r.asset_id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving assets:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve assets",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
