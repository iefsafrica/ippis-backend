import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

// Get database connection
const sql = neon(process.env.DATABASE_URL!)

// POST handler to mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = (session.user as any).id
    const body = await request.json()

    // Check if we're marking all as read or a specific notification
    if (body.all === true) {
      // Mark all notifications as read
      await sql(`UPDATE notifications SET is_read = true WHERE recipient_id = $1 AND is_read = false`, [userId])

      return NextResponse.json({ success: true })
    } else if (body.id) {
      // Mark a specific notification as read
      const result = await sql(
        `
        UPDATE notifications 
        SET is_read = true 
        WHERE id = $1 AND recipient_id = $2
        RETURNING id
        `,
        [body.id, userId],
      )

      if (result.length === 0) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 })
      }

      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }
  } catch (error) {
    console.error("Error marking notifications as read:", error)
    return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 })
  }
}
