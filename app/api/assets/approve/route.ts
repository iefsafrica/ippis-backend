import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { asset_ids?: string[] }
    const assetIds = body.asset_ids

    if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of asset_ids is required",
      }, 400)
    }

    const existing = await sql`
      SELECT asset_id FROM assets
      WHERE asset_id = ANY(${assetIds})
      AND asset_name IS NOT NULL AND asset_name != ''
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
