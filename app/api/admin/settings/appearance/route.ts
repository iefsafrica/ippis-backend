// app/api/admin/settings/appearance/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_THEMES  = ["light", "dark", "system"]
const VALID_FONTS   = ["Inter", "Roboto", "Poppins", "Open Sans", "Lato", "Nunito", "Outfit", "DM Sans"]
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings/appearance ────────────────────────────────────────
// Returns all appearance/theme settings
export async function GET(req: NextRequest) {
  try {
    const rows = await sql`
      SELECT key, value, data_type, updated_at, updated_by
      FROM admin_settings
      WHERE category = 'appearance'
      ORDER BY key ASC
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: "No appearance settings found. Run POST /api/admin/settings/init first.",
      }, 404)
    }

    const map: Record<string, any> = {}
    for (const row of rows) map[row.key] = row.value

    return withCors(req, {
      success: true,
      data: {
        systemTheme:    map["systemTheme"]    ?? "light",
        primaryColor:   map["primaryColor"]   ?? "#22c55e",
        secondaryColor: map["secondaryColor"] ?? "#f97316",
        fontFamily:     map["fontFamily"]     ?? "Inter",
      },
      options: {
        themes: VALID_THEMES,
        fonts:  VALID_FONTS,
      },
    })
  } catch (error) {
    console.error("Error fetching appearance settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch appearance settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── PUT /api/admin/settings/appearance ────────────────────────────────────────
// Body: { systemTheme?, primaryColor?, secondaryColor?, fontFamily?, updatedBy? }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as any
    const { systemTheme, primaryColor, secondaryColor, fontFamily, updatedBy } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    if (systemTheme !== undefined) {
      const theme = String(systemTheme).trim().toLowerCase()
      if (!VALID_THEMES.includes(theme)) {
        errors.push(`systemTheme must be one of: ${VALID_THEMES.join(", ")}.`)
      } else {
        updates.push({ key: "systemTheme", value: theme })
      }
    }

    if (primaryColor !== undefined) {
      const color = String(primaryColor).trim()
      if (!HEX_COLOR_REGEX.test(color)) {
        errors.push("primaryColor must be a valid hex color (e.g. #22c55e).")
      } else {
        updates.push({ key: "primaryColor", value: color })
      }
    }

    if (secondaryColor !== undefined) {
      const color = String(secondaryColor).trim()
      if (!HEX_COLOR_REGEX.test(color)) {
        errors.push("secondaryColor must be a valid hex color (e.g. #f97316).")
      } else {
        updates.push({ key: "secondaryColor", value: color })
      }
    }

    if (fontFamily !== undefined) {
      const font = String(fontFamily).trim()
      if (!VALID_FONTS.includes(font)) {
        errors.push(`fontFamily must be one of: ${VALID_FONTS.join(", ")}.`)
      } else {
        updates.push({ key: "fontFamily", value: font })
      }
    }

    if (errors.length > 0) {
      return withCors(req, { success: false, error: "Validation failed", details: errors }, 422)
    }

    if (updates.length === 0) {
      return withCors(req, { success: false, error: "No valid fields provided for update." }, 400)
    }

    const updatedByValue = updatedBy ? String(updatedBy).trim() : "system"
    const now = new Date().toISOString()

    for (const { key, value } of updates) {
      await sql`
        UPDATE admin_settings
        SET value = ${value}, updated_at = ${now}, updated_by = ${updatedByValue}
        WHERE key = ${key} AND category = 'appearance'
      `
    }

    const refreshed = await sql`
      SELECT key, value FROM admin_settings WHERE category = 'appearance'
    `
    const result: Record<string, string> = {}
    for (const row of refreshed) result[row.key] = row.value

    return withCors(req, {
      success: true,
      message: `${updates.length} appearance setting(s) updated successfully.`,
      updatedKeys: updates.map((u) => u.key),
      data: {
        systemTheme:    result["systemTheme"]    ?? "light",
        primaryColor:   result["primaryColor"]   ?? "#22c55e",
        secondaryColor: result["secondaryColor"] ?? "#f97316",
        fontFamily:     result["fontFamily"]     ?? "Inter",
      },
    })
  } catch (error) {
    console.error("Error updating appearance settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update appearance settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
