// app/api/admin/settings/general/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Supported languages and timezones for validation
const SUPPORTED_LANGUAGES = ["en", "fr", "ar", "ha", "yo", "ig"]
const SUPPORTED_TIMEZONES = [
  "Africa/Lagos",
  "Africa/Abidjan",
  "Africa/Accra",
  "Africa/Addis_Ababa",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Kigali",
  "Africa/Nairobi",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "UTC",
]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings/general ───────────────────────────────────────────
// Returns all general settings as a flat key→value object
export async function GET(req: NextRequest) {
  try {
    const rows = await sql`
      SELECT key, value, data_type, updated_at, updated_by
      FROM admin_settings
      WHERE category = 'general'
      ORDER BY key ASC
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: "No general settings found. Run the settings migration first.",
      }, 404)
    }

    // Shape into a convenient object for the frontend
    const settings: Record<string, any> = {}
    for (const row of rows) {
      settings[row.key] = {
        value: row.value,
        dataType: row.data_type,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }
    }

    return withCors(req, {
      success: true,
      data: {
        systemName: settings["systemName"]?.value ?? "IPPIS Admin Portal",
        systemLogo: settings["systemLogo"]?.value ?? "",
        systemLanguage: settings["systemLanguage"]?.value ?? "en",
        systemTimezone: settings["systemTimezone"]?.value ?? "Africa/Lagos",
        meta: settings,
      },
    })
  } catch (error) {
    console.error("Error fetching general settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch general settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── PUT /api/admin/settings/general ───────────────────────────────────────────
// Updates one or more general settings fields
// Body: { systemName?, systemLogo?, systemLanguage?, systemTimezone?, updatedBy? }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as any
    const { systemName, systemLogo, systemLanguage, systemTimezone, updatedBy } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    // ── Validate & queue systemName
    if (systemName !== undefined) {
      const name = String(systemName).trim()
      if (!name || name.length < 2) {
        errors.push("systemName must be at least 2 characters long.")
      } else if (name.length > 100) {
        errors.push("systemName must not exceed 100 characters.")
      } else {
        updates.push({ key: "systemName", value: name })
      }
    }

    // ── Validate & queue systemLogo
    if (systemLogo !== undefined) {
      const logo = String(systemLogo).trim()
      if (logo && !/^https?:\/\/.+/.test(logo)) {
        errors.push("systemLogo must be a valid URL starting with http:// or https://.")
      } else {
        updates.push({ key: "systemLogo", value: logo })
      }
    }

    // ── Validate & queue systemLanguage
    if (systemLanguage !== undefined) {
      const lang = String(systemLanguage).trim().toLowerCase()
      if (!SUPPORTED_LANGUAGES.includes(lang)) {
        errors.push(`systemLanguage '${lang}' is not supported. Allowed: ${SUPPORTED_LANGUAGES.join(", ")}.`)
      } else {
        updates.push({ key: "systemLanguage", value: lang })
      }
    }

    // ── Validate & queue systemTimezone
    if (systemTimezone !== undefined) {
      const tz = String(systemTimezone).trim()
      if (!SUPPORTED_TIMEZONES.includes(tz)) {
        errors.push(`systemTimezone '${tz}' is not supported.`)
      } else {
        updates.push({ key: "systemTimezone", value: tz })
      }
    }

    // Return validation errors before touching the DB
    if (errors.length > 0) {
      return withCors(req, {
        success: false,
        error: "Validation failed",
        details: errors,
      }, 422)
    }

    if (updates.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid fields provided for update.",
      }, 400)
    }

    const updatedByValue = updatedBy ? String(updatedBy).trim() : "system"
    const now = new Date().toISOString()

    // Apply each update individually (keyed upsert pattern)
    for (const { key, value } of updates) {
      await sql`
        UPDATE admin_settings
        SET
          value      = ${value},
          updated_at = ${now},
          updated_by = ${updatedByValue}
        WHERE key = ${key}
          AND category = 'general'
      `
    }

    // Return the fresh state of all general settings
    const refreshed = await sql`
      SELECT key, value
      FROM admin_settings
      WHERE category = 'general'
      ORDER BY key ASC
    `

    const result: Record<string, string> = {}
    for (const row of refreshed) {
      result[row.key] = row.value
    }

    return withCors(req, {
      success: true,
      message: `${updates.length} general setting(s) updated successfully.`,
      updatedKeys: updates.map((u) => u.key),
      data: {
        systemName: result["systemName"] ?? "",
        systemLogo: result["systemLogo"] ?? "",
        systemLanguage: result["systemLanguage"] ?? "",
        systemTimezone: result["systemTimezone"] ?? "",
      },
    })
  } catch (error) {
    console.error("Error updating general settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update general settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
