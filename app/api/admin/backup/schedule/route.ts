// app/api/admin/backup/schedule/route.ts
// GET  → get the current backup schedule
// POST → save/update the backup schedule
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_FREQUENCIES = ["disabled", "daily", "weekly", "monthly"]
const VALID_DAYS        = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const VALID_BACKUP_TYPES = ["full", "partial"]
const VALID_LOCATIONS    = ["local", "cloud"]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/backup/schedule ───────────────────────────────────────────
// Returns the current backup schedule from admin_settings
export async function GET(req: NextRequest) {
  try {
    const rows = await sql`
      SELECT key, value FROM admin_settings
      WHERE key IN (
        'backupScheduleEnabled',
        'backupFrequency',
        'backupDay',
        'backupTime',
        'backupType',
        'backupLocation',
        'backupRetentionDays',
        'backupEncryption',
        'backupCompression'
      )
    `

    const map: Record<string, string> = {}
    for (const row of rows) map[row.key] = row.value

    return withCors(req, {
      success: true,
      data: {
        enabled:       map["backupScheduleEnabled"] === "true",
        frequency:     map["backupFrequency"]       ?? "disabled",
        day:           map["backupDay"]             ?? "monday",
        time:          map["backupTime"]            ?? "02:00",
        backupType:    map["backupType"]            ?? "full",
        location:      map["backupLocation"]        ?? "local",
        retentionDays: parseInt(map["backupRetentionDays"] ?? "30"),
        encryption:    map["backupEncryption"]      ?? "AES-256",
        compression:   map["backupCompression"]     ?? "medium",
      },
    })
  } catch (error) {
    console.error("Error fetching backup schedule:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch backup schedule",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── POST /api/admin/backup/schedule ──────────────────────────────────────────
// Saves the backup schedule into admin_settings
// Body: { enabled?, frequency?, day?, time?, backupType?, location?, retentionDays?, encryption?, compression?, updatedBy? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any
    const {
      enabled, frequency, day, time,
      backupType, location, retentionDays,
      encryption, compression, updatedBy = "system",
    } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    if (enabled !== undefined) {
      if (typeof enabled !== "boolean")
        errors.push("enabled must be a boolean.")
      else
        updates.push({ key: "backupScheduleEnabled", value: String(enabled) })
    }

    if (frequency !== undefined) {
      if (!VALID_FREQUENCIES.includes(frequency))
        errors.push(`frequency must be one of: ${VALID_FREQUENCIES.join(", ")}.`)
      else
        updates.push({ key: "backupFrequency", value: frequency })
    }

    if (day !== undefined) {
      if (!VALID_DAYS.includes(String(day).toLowerCase()))
        errors.push(`day must be one of: ${VALID_DAYS.join(", ")}.`)
      else
        updates.push({ key: "backupDay", value: String(day).toLowerCase() })
    }

    if (time !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(String(time)))
        errors.push("time must be in HH:MM format (e.g. 02:00).")
      else
        updates.push({ key: "backupTime", value: String(time) })
    }

    if (backupType !== undefined) {
      if (!VALID_BACKUP_TYPES.includes(backupType))
        errors.push(`backupType must be one of: ${VALID_BACKUP_TYPES.join(", ")}.`)
      else
        updates.push({ key: "backupType", value: backupType })
    }

    if (location !== undefined) {
      if (!VALID_LOCATIONS.includes(location))
        errors.push(`location must be one of: ${VALID_LOCATIONS.join(", ")}.`)
      else
        updates.push({ key: "backupLocation", value: location })
    }

    if (retentionDays !== undefined) {
      const days = parseInt(retentionDays)
      if (isNaN(days) || days < 1 || days > 365)
        errors.push("retentionDays must be a number between 1 and 365.")
      else
        updates.push({ key: "backupRetentionDays", value: String(days) })
    }

    if (encryption !== undefined) {
      updates.push({ key: "backupEncryption", value: String(encryption) })
    }

    if (compression !== undefined) {
      updates.push({ key: "backupCompression", value: String(compression) })
    }

    if (errors.length > 0) {
      return withCors(req, { success: false, error: "Validation failed", details: errors }, 422)
    }

    if (updates.length === 0) {
      return withCors(req, { success: false, error: "No valid fields provided." }, 400)
    }

    const now = new Date().toISOString()

    // Upsert each schedule setting
    for (const { key, value } of updates) {
      await sql`
        INSERT INTO admin_settings (key, value, category, data_type, updated_by, updated_at)
        VALUES (${key}, ${value}, 'advanced', 'string', ${String(updatedBy)}, ${now})
        ON CONFLICT (key) DO UPDATE
          SET value      = EXCLUDED.value,
              updated_by = EXCLUDED.updated_by,
              updated_at = EXCLUDED.updated_at
      `
    }

    return withCors(req, {
      success: true,
      message: "Backup schedule saved successfully.",
      updatedKeys: updates.map((u) => u.key),
    })
  } catch (error) {
    console.error("Error saving backup schedule:", error)
    return withCors(req, {
      success: false,
      error: "Failed to save backup schedule",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
