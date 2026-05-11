// app/api/admin/backup/[id]/route.ts
// GET    → fetch a single backup record by ID
// DELETE → permanently delete a backup record
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Helper: extract the backup ID from the URL path
// Path: /api/admin/backup/[id]
function getBackupId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean)
  const backupIdx = segments.findIndex((s) => s === "backup")
  return segments[backupIdx + 1] ?? ""
}

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/backup/[id] ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const id = getBackupId(req)

    if (!id) {
      return withCors(req, { success: false, error: "Missing backup ID." }, 400)
    }

    const rows = await sql`
      SELECT id, backup_name, backup_type, location, compression, encryption,
             status, size_bytes, tables_included, row_counts, error_message,
             created_by, created_at, completed_at, restored_at, restored_by
      FROM database_backups
      WHERE id = ${id}
      LIMIT 1
    `

    const backup = rows[0]
    if (!backup) {
      return withCors(req, { success: false, error: `Backup with id '${id}' not found.` }, 404)
    }

    return withCors(req, {
      success: true,
      data: {
        ...backup,
        sizeMB: backup.size_bytes ? (backup.size_bytes / 1024 / 1024).toFixed(2) : null,
      },
    })
  } catch (error) {
    console.error("Error fetching backup:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch backup",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── DELETE /api/admin/backup/[id] ────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const id = getBackupId(req)

    if (!id) {
      return withCors(req, { success: false, error: "Missing backup ID." }, 400)
    }

    const rows = await sql`
      DELETE FROM database_backups
      WHERE id = ${id}
      RETURNING id, backup_name
    `

    if (rows.length === 0) {
      return withCors(req, { success: false, error: `Backup with id '${id}' not found.` }, 404)
    }

    return withCors(req, {
      success: true,
      message: `Backup '${rows[0].backup_name}' deleted successfully.`,
      deletedId: rows[0].id,
    })
  } catch (error) {
    console.error("Error deleting backup:", error)
    return withCors(req, {
      success: false,
      error: "Failed to delete backup",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
