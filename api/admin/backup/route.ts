import { NextResponse } from "next/server"
import { backupService } from "@/app/admin/services/backup-service"

// Get all backups
export async function GET() {
  const result = await backupService.getBackups()

  if (result.success) {
    return NextResponse.json(result)
  } else {
    return NextResponse.json(result, { status: 500 })
  }
}

// Create a new backup
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.type || !body.location || !body.performedBy) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    const result = await backupService.createBackup({
      type: body.type,
      location: body.location,
      compression: body.compression || "medium",
      encryption: body.encryption || "none",
      name: body.name,
      performedBy: body.performedBy,
    })

    if (result.success) {
      return NextResponse.json({
        ...result,
        message: "Database backup created successfully",
      })
    } else {
      return NextResponse.json(result, { status: 500 })
    }
  } catch (error) {
    console.error("Failed to create backup:", error)
    return NextResponse.json({ success: false, error: "Failed to create backup" }, { status: 500 })
  }
}
