// app/api/admin/backup/[id]/restore/route.ts
// POST → restore the system from a specific backup
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Tables that are safe to restore (order matters for FK constraints)
const RESTORABLE_TABLES = ["admin_settings", "admin_permissions"]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── POST /api/admin/backup/[id]/restore ──────────────────────────────────────
// Restores data from a backup.
// Body: { tables?: string[], restoredBy?: string, confirmRestore: true }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json() as any
    const { tables, restoredBy = "system", confirmRestore } = body

    // Safety gate — require explicit confirmation
    if (!confirmRestore) {
      return withCors(req, {
        success: false,
        error: "Restore requires explicit confirmation. Set confirmRestore: true in the request body.",
      }, 400)
    }

    // ── Fetch the backup record
    const rows = await sql`
      SELECT id, backup_name, backup_type, status, backup_data, tables_included
      FROM database_backups
      WHERE id = ${id}
      LIMIT 1
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: `Backup with id '${id}' not found.`,
      }, 404)
    }

    const backup = rows[0]

    if (backup.status !== "completed") {
      return withCors(req, {
        success: false,
        error: `Cannot restore from a backup with status '${backup.status}'. Only 'completed' backups can be restored.`,
      }, 409)
    }

    const backupData: Record<string, any[]> = backup.backup_data ?? {}

    // Determine which tables to restore
    const requestedTables: string[] = tables && Array.isArray(tables)
      ? tables.filter((t: string) => RESTORABLE_TABLES.includes(t))
      : RESTORABLE_TABLES.filter((t) => Object.keys(backupData).includes(t))

    if (requestedTables.length === 0) {
      return withCors(req, {
        success: false,
        error: `No restorable tables found. Restorable tables are: ${RESTORABLE_TABLES.join(", ")}.`,
      }, 400)
    }

    const restored: Record<string, number> = {}
    const skipped:  string[] = []

    // ── Restore each table
    for (const table of requestedTables) {
      const tableData: any[] = backupData[table] ?? []
      if (!tableData.length) {
        skipped.push(table)
        continue
      }

      // For admin_settings: upsert by key
      if (table === "admin_settings") {
        let count = 0
        for (const row of tableData) {
          await sql`
            INSERT INTO admin_settings (key, value, category, data_type, updated_by, updated_at)
            VALUES (
              ${row.key}, ${row.value}, ${row.category},
              ${row.data_type}, ${"restore:" + restoredBy}, ${new Date().toISOString()}
            )
            ON CONFLICT (key) DO UPDATE
              SET value      = EXCLUDED.value,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at
          `
          count++
        }
        restored[table] = count
      }

      // For admin_permissions: upsert by (role, resource, action)
      if (table === "admin_permissions") {
        let count = 0
        for (const row of tableData) {
          await sql`
            INSERT INTO admin_permissions (role, resource, action, is_allowed)
            VALUES (${row.role}, ${row.resource}, ${row.action}, ${row.is_allowed})
            ON CONFLICT (role, resource, action) DO UPDATE
              SET is_allowed = EXCLUDED.is_allowed
          `
          count++
        }
        restored[table] = count
      }
    }

    // ── Mark backup as restored
    await sql`
      UPDATE database_backups
      SET restored_at = ${new Date().toISOString()}, restored_by = ${String(restoredBy)}
      WHERE id = ${id}
    `

    return withCors(req, {
      success: true,
      message: "Restore completed successfully.",
      data: {
        backupId:   id,
        backupName: backup.backup_name,
        restored,
        skipped,
        restoredBy,
        restoredAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Error restoring backup:", error)
    return withCors(req, {
      success: false,
      error: "Failed to restore backup",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
