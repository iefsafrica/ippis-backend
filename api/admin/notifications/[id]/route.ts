import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

// Get database connection
const sql = neon(process.env.DATABASE_URL!)

// DELETE handler to delete a specific notification
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = (session.user as any).id
    const notificationId = params.id

    // Delete the notification
    const result = await sql(
      `
      DELETE FROM notifications 
      WHERE id = $1 AND recipient_id = $2
      RETURNING id
      `,
      [notificationId, userId],
    )

    if (result.length === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting notification:", error)
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 })
  }
}
