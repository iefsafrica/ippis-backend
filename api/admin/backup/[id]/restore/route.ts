import { NextResponse } from "next/server"
import { backupService } from "@/app/admin/services/backup-service"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const body = await request.json()

    if (!body.performedBy) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    const result = await backupService.restoreBackup({
      backupId: id,
      restoreType: body.restoreType || "complete",
      performedBy: body.performedBy,
    })

    if (result.success) {
      return NextResponse.json(result)
    } else {
      return NextResponse.json(result, { status: result.error === "Backup not found" ? 404 : 500 })
    }
  } catch (error) {
    console.error("Failed to restore database:", error)
    return NextResponse.json({ success: false, error: "Failed to restore database" }, { status: 500 })
  }
}
