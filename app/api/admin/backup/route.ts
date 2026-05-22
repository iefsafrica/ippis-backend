// app/api/admin/backup/route.ts
// Administrative Database Backup & History API
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_BACKUP_TYPES = ["full", "partial"]
const VALID_LOCATIONS = ["local", "cloud"]
const VALID_COMPRESSIONS = ["none", "low", "medium", "high"]
const VALID_ENCRYPTIONS = ["none", "AES-128", "AES-256"]

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

// ─── GET /api/admin/backup ──────────────────────────────────────────────────────
// Returns the list of recent backups (History)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "20")
    const offset = parseInt(searchParams.get("offset") || "0")

    const rows = await sql`
      SELECT id, backup_name, backup_type, location, compression, encryption, 
             status, size_bytes, tables_included, row_counts, created_by, 
             created_at, completed_at, restored_at, restored_by
      FROM database_backups
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const result = await sql`SELECT COUNT(*)::int AS count FROM database_backups`
    const count = result[0]?.count ?? 0

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

// ─── POST /api/admin/backup ─────────────────────────────────────────────────────
// Triggers a new manual backup
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any
    const {
      backupName,
      backupType = "full",
      location = "local",
      compression = "none",
      encryption = "none",
      createdBy = "System Admin"
    } = body

    // Validation
    if (!VALID_BACKUP_TYPES.includes(backupType)) {
      return withCors(req, { success: false, error: `Invalid backup type: ${backupType}` }, 400)
    }

    const name = backupName
      ? String(backupName).trim()
      : `backup_${backupType}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`

    // ── Create the backup record (status = in_progress)
    const rows = await sql`
      INSERT INTO database_backups
        (backup_name, backup_type, location, compression, encryption, status, created_by)
      VALUES
        (${name}, ${backupType}, ${location}, ${compression}, ${encryption}, 'in_progress', ${String(createdBy)})
      RETURNING id, backup_name, created_at
    `

    const record = rows[0] as any
    if (!record) {
      throw new Error("Failed to create backup record in database")
    }

    const backupId = record.id

    // ── Perform the backup: query each table and capture data + row counts
    const rowCounts: Record<string, number> = {}
    const backupData: Record<string, any[]> = {}
    let totalRows = 0

    const tablesToBackup = backupType === "full" ? FULL_BACKUP_TABLES : ["admin_settings"]

    for (const table of tablesToBackup) {
      try {
        // @ts-ignore - Dynamic table selection from trusted internal list
        const tableRows = await (sql as any)([`SELECT * FROM ${table} LIMIT 5000`])
        rowCounts[table] = tableRows.length
        backupData[table] = tableRows
        totalRows += tableRows.length
      } catch (err) {
        console.warn(`Could not backup table ${table}:`, err)
        rowCounts[table] = 0
      }
    }

    const sizeEstimate = JSON.stringify(backupData).length

    // ── Update the backup record with the captured data
    await sql`
      UPDATE database_backups
      SET 
        status = 'completed',
        size_bytes = ${sizeEstimate},
        tables_included = ${tablesToBackup},
        row_counts = ${JSON.stringify(rowCounts)},
        backup_data = ${JSON.stringify(backupData)},
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ${backupId}
    `

    return withCors(req, {
      success: true,
      message: `Backup '${name}' completed successfully.`,
      backupId,
      summary: {
        tables: tablesToBackup.length,
        totalRows,
        sizeBytes: sizeEstimate
      }
    })

  } catch (error) {
    console.error("Backup process failed:", error)

    // Attempt to log failure in DB if we have a name
    try {
      const body = await req.clone().json() as any
      const name = body.backupName || "failed_backup"
      await sql`
        INSERT INTO database_backups (backup_name, backup_type, status, error_message)
        VALUES (${name}, 'full', 'failed', ${error instanceof Error ? error.message : String(error)})
      `
    } catch (dbErr) {
      console.error("Could not log backup failure to DB:", dbErr)
    }

    return withCors(req, {
      success: false,
      error: "Backup process failed",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}
