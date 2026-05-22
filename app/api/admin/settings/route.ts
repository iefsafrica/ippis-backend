// app/api/admin/settings/route.ts
// Base settings endpoint — returns ALL settings grouped by category
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings ────────────────────────────────────────────────────
// Returns all settings grouped by category.
// Optional query param: ?category=general|notifications|email|appearance|advanced
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get("category")

    const rows = category
      ? await sql`
          SELECT key, value, category, data_type, updated_at, updated_by
          FROM admin_settings
          WHERE category = ${category}
          ORDER BY category, key ASC
        `
      : await sql`
          SELECT key, value, category, data_type, updated_at, updated_by
          FROM admin_settings
          ORDER BY category, key ASC
        `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: category
          ? `No settings found for category '${category}'.`
          : "No settings found. Run the settings migration first.",
      }, 404)
    }

    // Group by category
    const grouped: Record<string, Record<string, any>> = {}
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = {}
      grouped[row.category][row.key] = {
        value: row.value,
        dataType: row.data_type,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }
    }

    return withCors(req, {
      success: true,
      categories: Object.keys(grouped),
      data: grouped,
    })
  } catch (error) {
    console.error("Error fetching settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
