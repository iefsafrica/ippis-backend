import { NextResponse } from "next/server"
import { backupService } from "@/app/admin/services/backup-service"

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const { searchParams } = new URL(request.url)
    const performedBy = searchParams.get("performedBy") || "admin"

    const result = await backupService.deleteBackup(id, performedBy)

    if (result.success) {
      return NextResponse.json(result)
    } else {
      return NextResponse.json(result, { status: result.error === "Backup not found" ? 404 : 500 })
    }
  } catch (error) {
    console.error("Failed to delete backup:", error)
    return NextResponse.json({ success: false, error: "Failed to delete backup" }, { status: 500 })
  }
}
