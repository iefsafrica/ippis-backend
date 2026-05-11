// app/api/admin/backup/[id]/download/route.ts
// GET → download a backup as a JSON file
import { neon } from "@neondatabase/serverless"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Helper: extract the backup ID from the URL path
// Path: /api/admin/backup/[id]/download
function getBackupId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean)
  const backupIdx = segments.findIndex((s) => s === "backup")
  return segments[backupIdx + 1] ?? ""
}

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

// ─── GET /api/admin/backup/[id]/download ──────────────────────────────────────
// Streams the backup as a downloadable JSON file
export async function GET(req: NextRequest) {
  try {
    const id = getBackupId(req)

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing backup ID." }, { status: 400 })
    }

    const rows = await sql`
      SELECT id, backup_name, backup_type, location, compression, encryption,
             status, size_bytes, tables_included, row_counts, backup_data,
             created_by, created_at, completed_at
      FROM database_backups
      WHERE id = ${id}
      LIMIT 1
    `

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: `Backup '${id}' not found.` }, { status: 404 })
    }

    const backup = rows[0]

    if (backup.status !== "completed") {
      return NextResponse.json(
        { success: false, error: `Only completed backups can be downloaded. Status: ${backup.status}` },
        { status: 409 }
      )
    }

    const downloadPayload = {
      meta: {
        backupId:       backup.id,
        backupName:     backup.backup_name,
        backupType:     backup.backup_type,
        location:       backup.location,
        compression:    backup.compression,
        encryption:     backup.encryption,
        sizeBytes:      backup.size_bytes,
        tablesIncluded: backup.tables_included,
        rowCounts:      backup.row_counts,
        createdBy:      backup.created_by,
        createdAt:      backup.created_at,
        completedAt:    backup.completed_at,
        exportedAt:     new Date().toISOString(),
        system:         "IPPIS Admin Portal",
      },
      data: backup.backup_data ?? {},
    }

    const fileName = `${backup.backup_name ?? `backup_${id}`}.json`
      .replace(/\s+/g, "_")
      .toLowerCase()

    const jsonContent = JSON.stringify(downloadPayload, null, 2)

    return new NextResponse(jsonContent, {
      status: 200,
      headers: {
        "Content-Type":        "application/json",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length":      Buffer.byteLength(jsonContent, "utf8").toString(),
        "Cache-Control":       "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch (error) {
    console.error("Error downloading backup:", error)
    return NextResponse.json({
      success: false,
      error: "Failed to download backup",
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
