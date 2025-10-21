import { type NextRequest, NextResponse } from "next/server"
import { backupService } from "@/app/admin/services/backup-service"
import fs from "fs"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const backupId = params.id

    // Get the backup file
    const result = await backupService.getBackupFile(backupId)

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to get backup file" }, { status: 404 })
    }

    const { filePath, fileName, contentType } = result.data

    // Read the file
    const fileBuffer = fs.readFileSync(filePath)

    // Create response with appropriate headers
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    })

    return response
  } catch (error) {
    console.error("Error downloading backup:", error)
    return NextResponse.json({ error: "Failed to download backup" }, { status: 500 })
  }
}
