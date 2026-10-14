// app/api/admin/settings/email/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings/email ─────────────────────────────────────────────
// Returns all email/SMTP settings (passwords are masked)
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "settings.system.view")
    if (!auth.ok) return auth.response

    const rows = await sql`
      SELECT key, value, data_type, updated_at, updated_by
      FROM admin_settings
      WHERE category = 'email'
      ORDER BY key ASC
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: "No email settings found. Run POST /api/admin/settings/init first.",
      }, 404)
    }

    const map: Record<string, any> = {}
    for (const row of rows) map[row.key] = row

    return withCors(req, {
      success: true,
      data: {
        emailServer:   map["emailServer"]?.value   ?? "",
        emailPort:     map["emailPort"]?.value     ?? "",
        emailUsername: map["emailUsername"]?.value ?? "",
        // Mask password — only show whether it is set
        emailPassword: map["emailPassword"]?.value ? "••••••••" : "",
        emailFrom:     map["emailFrom"]?.value     ?? "",
        emailReplyTo:  map["emailReplyTo"]?.value  ?? "",
        emailTemplate: map["emailTemplate"]?.value ?? "",
        meta: {
          updatedAt: map["emailServer"]?.updated_at ?? null,
          updatedBy: map["emailServer"]?.updated_by ?? null,
        },
      },
    })
  } catch (error) {
    console.error("Error fetching email settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch email settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── PUT /api/admin/settings/email ─────────────────────────────────────────────
// Body: { emailServer?, emailPort?, emailUsername?, emailPassword?, emailFrom?, emailReplyTo?, emailTemplate? }
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "settings.system.manage")
    if (!auth.ok) return auth.response

    const body = await req.json() as any
    const {
      emailServer, emailPort, emailUsername, emailPassword,
      emailFrom, emailReplyTo, emailTemplate,
    } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    if (emailServer !== undefined) {
      const val = String(emailServer).trim()
      if (val && !/^[\w.-]+$/.test(val) && !/^https?:\/\/.+/.test(val)) {
        errors.push("emailServer must be a valid hostname or URL (e.g. smtp.gmail.com).")
      } else {
        updates.push({ key: "emailServer", value: val })
      }
    }

    if (emailPort !== undefined) {
      const port = Number(emailPort)
      if (emailPort !== "" && (isNaN(port) || port < 1 || port > 65535)) {
        errors.push("emailPort must be a valid port number between 1 and 65535.")
      } else {
        updates.push({ key: "emailPort", value: String(emailPort).trim() })
      }
    }

    if (emailUsername !== undefined) {
      updates.push({ key: "emailUsername", value: String(emailUsername).trim() })
    }

    if (emailPassword !== undefined) {
      const pwd = String(emailPassword).trim()
      // Ignore if the frontend sends back the masked placeholder
      if (pwd && pwd !== "••••••••") {
        updates.push({ key: "emailPassword", value: pwd })
      }
    }

    if (emailFrom !== undefined) {
      const from = String(emailFrom).trim()
      if (from && !EMAIL_REGEX.test(from)) {
        errors.push("emailFrom must be a valid email address.")
      } else {
        updates.push({ key: "emailFrom", value: from })
      }
    }

    if (emailReplyTo !== undefined) {
      const replyTo = String(emailReplyTo).trim()
      if (replyTo && !EMAIL_REGEX.test(replyTo)) {
        errors.push("emailReplyTo must be a valid email address.")
      } else {
        updates.push({ key: "emailReplyTo", value: replyTo })
      }
    }

    if (emailTemplate !== undefined) {
      updates.push({ key: "emailTemplate", value: String(emailTemplate).trim() })
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
        WHERE key = ${key} AND category = 'email'
      `
    }

    // Return refreshed (password still masked)
    const refreshed = await sql`
      SELECT key, value FROM admin_settings WHERE category = 'email'
    `
    const result: Record<string, string> = {}
    for (const row of refreshed) result[row.key] = row.value

    // Keys only: values can include the SMTP password
    await runAudited(req, auth.ctx, {
      action: "settings.system.updated",
      targetType: "settings",
      targetId: "email",
      details: { keys: updates.map((u) => u.key) },
    }, [])

    return withCors(req, {
      success: true,
      message: `${updates.length} email setting(s) updated successfully.`,
      updatedKeys: updates.map((u) => u.key),
      data: {
        emailServer:   result["emailServer"]   ?? "",
        emailPort:     result["emailPort"]     ?? "",
        emailUsername: result["emailUsername"] ?? "",
        emailPassword: result["emailPassword"] ? "••••••••" : "",
        emailFrom:     result["emailFrom"]     ?? "",
        emailReplyTo:  result["emailReplyTo"]  ?? "",
        emailTemplate: result["emailTemplate"] ?? "",
      },
    })
  } catch (error) {
    console.error("Error updating email settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update email settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
