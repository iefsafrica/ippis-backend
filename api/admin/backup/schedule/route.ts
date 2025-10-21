import { NextResponse } from "next/server"
import { backupService } from "@/app/admin/services/backup-service"

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.frequency || !body.time || !body.performedBy) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    const result = await backupService.scheduleBackup({
      frequency: body.frequency,
      time: body.time,
      retentionPeriod: Number.parseInt(body.retentionPeriod) || 30,
      maxBackups: Number.parseInt(body.maxBackups) || 10,
      type: body.type || "full",
      location: body.location || "local",
      compression: body.compression || "medium",
      encryption: body.encryption || "none",
      performedBy: body.performedBy,
    })

    if (result.success) {
      return NextResponse.json({
        ...result,
        message: "Backup schedule saved successfully",
      })
    } else {
      return NextResponse.json(result, { status: 500 })
    }
  } catch (error) {
    console.error("Failed to schedule backup:", error)
    return NextResponse.json({ success: false, error: "Failed to schedule backup" }, { status: 500 })
  }
}
