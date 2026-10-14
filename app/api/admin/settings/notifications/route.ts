// app/api/admin/settings/notifications/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_FREQUENCIES = ["immediate", "hourly", "daily", "weekly"]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings/notifications ─────────────────────────────────────
// Returns all notification settings as a clean object
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "settings.system.view")
    if (!auth.ok) return auth.response

    const rows = await sql`
      SELECT key, value, data_type, updated_at, updated_by
      FROM admin_settings
      WHERE category = 'notifications'
      ORDER BY key ASC
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: "No notification settings found. Run POST /api/admin/settings/init first.",
      }, 404)
    }

    const map: Record<string, any> = {}
    for (const row of rows) {
      map[row.key] = row.value
    }

    return withCors(req, {
      success: true,
      data: {
        emailNotifications:    map["emailNotifications"] === "true",
        systemNotifications:   map["systemNotifications"] === "true",
        notificationFrequency: map["notificationFrequency"] ?? "immediate",
      },
    })
  } catch (error) {
    console.error("Error fetching notification settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch notification settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── PUT /api/admin/settings/notifications ─────────────────────────────────────
// Body: { emailNotifications?: boolean, systemNotifications?: boolean, notificationFrequency?: string }
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "settings.system.manage")
    if (!auth.ok) return auth.response

    const body = await req.json() as any
    const { emailNotifications, systemNotifications, notificationFrequency } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    if (emailNotifications !== undefined) {
      if (typeof emailNotifications !== "boolean") {
        errors.push("emailNotifications must be a boolean (true or false).")
      } else {
        updates.push({ key: "emailNotifications", value: String(emailNotifications) })
      }
    }

    if (systemNotifications !== undefined) {
      if (typeof systemNotifications !== "boolean") {
        errors.push("systemNotifications must be a boolean (true or false).")
      } else {
        updates.push({ key: "systemNotifications", value: String(systemNotifications) })
      }
    }

    if (notificationFrequency !== undefined) {
      const freq = String(notificationFrequency).trim().toLowerCase()
      if (!VALID_FREQUENCIES.includes(freq)) {
        errors.push(`notificationFrequency must be one of: ${VALID_FREQUENCIES.join(", ")}.`)
      } else {
        updates.push({ key: "notificationFrequency", value: freq })
      }
    }

    if (errors.length > 0) {
      return withCors(req, { success: false, error: "Validation failed", details: errors }, 422)
    }

    if (updates.length === 0) {
      return withCors(req, { success: false, error: "No valid fields provided for update." }, 400)
    }

    // Attribution comes from the session, not the request body
    const updatedByValue = auth.ctx.user.username
    const now = new Date().toISOString()

    for (const { key, value } of updates) {
      await sql`
        UPDATE admin_settings
        SET value = ${value}, updated_at = ${now}, updated_by = ${updatedByValue}
        WHERE key = ${key} AND category = 'notifications'
      `
    }

    // Return refreshed values
    const refreshed = await sql`
      SELECT key, value FROM admin_settings WHERE category = 'notifications'
    `
    const result: Record<string, string> = {}
    for (const row of refreshed) result[row.key] = row.value

    await runAudited(req, auth.ctx, {
      action: "settings.system.updated",
      targetType: "settings",
      targetId: "notifications",
      details: { keys: updates.map((u) => u.key) },
    }, [])

    return withCors(req, {
      success: true,
      message: `${updates.length} notification setting(s) updated successfully.`,
      updatedKeys: updates.map((u) => u.key),
      data: {
        emailNotifications:    result["emailNotifications"] === "true",
        systemNotifications:   result["systemNotifications"] === "true",
        notificationFrequency: result["notificationFrequency"] ?? "immediate",
      },
    })
  } catch (error) {
    console.error("Error updating notification settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update notification settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
