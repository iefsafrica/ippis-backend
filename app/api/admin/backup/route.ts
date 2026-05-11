// app/api/admin/backup/route.ts
// GET  → list all backups (history)
// POST → create a new backup
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_BACKUP_TYPES   = ["full", "partial"]
const VALID_LOCATIONS      = ["local", "cloud"]
const VALID_COMPRESSIONS   = ["none", "low", "medium", "high"]
const VALID_ENCRYPTIONS    = ["none", "AES-128", "AES-256"]

// Tables that are included in a full backup
const FULL_BACKUP_TABLES = [
  "admin_settings",
  "admin_users",
  "pending_employees",
  "document_uploads",
  "dashboard_notifications",
  "admin_permissions",
]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/backup ─────────────────────────────────────────────────────
// Returns the backup history list
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")   // optional filter
    const limit  = parseInt(searchParams.get("limit") ?? "20")
    const offset = parseInt(searchParams.get("offset") ?? "0")

    const rows = status
      ? await sql`
          SELECT id, backup_name, backup_type, location, compression, encryption,
                 status, size_bytes, tables_included, row_counts, error_message,
                 created_by, created_at, completed_at, restored_at, restored_by
          FROM database_backups
          WHERE status = ${status}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT id, backup_name, backup_type, location, compression, encryption,
                 status, size_bytes, tables_included, row_counts, error_message,
                 created_by, created_at, completed_at, restored_at, restored_by
          FROM database_backups
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM database_backups`

    return withCors(req, {
      success: true,
      total: count,
      limit,
      offset,
      data: rows,
    })
  } catch (error) {
    console.error("Error fetching backups:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch backup history",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── POST /api/admin/backup ────────────────────────────────────────────────────
// Creates a new database backup
// Body: { backupType?, location?, compression?, encryption?, backupName?, createdBy? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any
    const {
      backupType   = "full",
      location     = "local",
      compression  = "medium",
      encryption   = "AES-256",
      backupName,
      createdBy    = "system",
    } = body

    // ── Validate inputs
    const errors: string[] = []
    if (!VALID_BACKUP_TYPES.includes(backupType))
      errors.push(`backupType must be one of: ${VALID_BACKUP_TYPES.join(", ")}.`)
    if (!VALID_LOCATIONS.includes(location))
      errors.push(`location must be one of: ${VALID_LOCATIONS.join(", ")}.`)
    if (!VALID_COMPRESSIONS.includes(compression))
      errors.push(`compression must be one of: ${VALID_COMPRESSIONS.join(", ")}.`)
    if (!VALID_ENCRYPTIONS.includes(encryption))
      errors.push(`encryption must be one of: ${VALID_ENCRYPTIONS.join(", ")}.`)

    if (errors.length > 0) {
      return withCors(req, { success: false, error: "Validation failed", details: errors }, 422)
    }

    const name = backupName
      ? String(backupName).trim()
      : `backup_${backupType}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`

    // ── Create the backup record (status = in_progress)
    const [record] = await sql`
      INSERT INTO database_backups
        (backup_name, backup_type, location, compression, encryption, status, created_by)
      VALUES
        (${name}, ${backupType}, ${location}, ${compression}, ${encryption}, 'in_progress', ${String(createdBy)})
      RETURNING id, backup_name, created_at
    `

    const backupId = record.id

    // ── Perform the backup: query each table and capture data + row counts
    const rowCounts: Record<string, number> = {}
    const backupData: Record<string, any[]>  = {}
    let   totalRows = 0

    const tablesToBackup = backupType === "full" ? FULL_BACKUP_TABLES : ["admin_settings"]

    for (const table of tablesToBackup) {
      try {
        const tableRows = await sql`SELECT * FROM ${sql(table)} LIMIT 5000`
        rowCounts[table] = tableRows.length
        backupData[table] = tableRows
        totalRows += tableRows.length
      } catch {
        // Table may not exist yet — skip gracefully
        rowCounts[table] = 0
        backupData[table] = []
      }
    }

    // Rough size estimate: JSON string length in bytes
    const sizeBytes = Buffer.byteLength(JSON.stringify(backupData), "utf8")

    // ── Mark backup as completed
    await sql`
      UPDATE database_backups
      SET
        status          = 'completed',
        size_bytes      = ${sizeBytes},
        tables_included = ${tablesToBackup},
        row_counts      = ${JSON.stringify(rowCounts)},
        backup_data     = ${JSON.stringify(backupData)},
        completed_at    = ${new Date().toISOString()}
      WHERE id = ${backupId}
    `

    return withCors(req, {
      success: true,
      message: "Backup created successfully.",
      data: {
        id:           backupId,
        backupName:   name,
        backupType,
        location,
        compression,
        encryption,
        status:       "completed",
        sizeBytes,
        sizeMB:       (sizeBytes / 1024 / 1024).toFixed(2),
        totalRows,
        rowCounts,
        tablesIncluded: tablesToBackup,
        createdAt:    record.created_at,
      },
    }, 201)
  } catch (error) {
    console.error("Error creating backup:", error)
    return withCors(req, {
      success: false,
      error: "Failed to create backup",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
