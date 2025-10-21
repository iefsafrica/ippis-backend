import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

// Get database connection
const sql = neon(process.env.DATABASE_URL!)

// GET handler to fetch notifications
export async function GET(request: NextRequest) {
  try {
    // Get the current user session
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user ID from session
    const userId = (session.user as any).id

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const limit = Number.parseInt(searchParams.get("limit") || "10", 10)
    const offset = Number.parseInt(searchParams.get("offset") || "0", 10)
    const unreadOnly = searchParams.get("unread") === "true"

    // Build the query
    let query = `
      SELECT id, title, message, type, is_read as "isRead", 
             created_at as "createdAt", expires_at as "expiresAt", 
             action_url as "actionUrl"
      FROM notifications
      WHERE recipient_id = $1
    `

    const queryParams = [userId]

    if (unreadOnly) {
      query += " AND is_read = false"
    }

    query += " ORDER BY created_at DESC LIMIT $2 OFFSET $3"
    queryParams.push(limit, offset)

    // Execute the query
    const notifications = await sql(query, queryParams)

    // Get the total count
    const countResult = await sql(
      `SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 ${unreadOnly ? "AND is_read = false" : ""}`,
      [userId],
    )

    const total = Number.parseInt(countResult[0].count, 10)

    return NextResponse.json({
      notifications,
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error("Error fetching notifications:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

// POST handler to create a new notification
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins can create notifications
    if ((session.user as any).role !== "admin" && (session.user as any).role !== "superadmin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { title, message, type, recipientId, expiresAt, actionUrl } = body

    // Validate required fields
    if (!title || !message || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Validate type
    const validTypes = ["info", "warning", "success", "error"]
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid notification type" }, { status: 400 })
    }

    // Insert the notification
    const result = await sql(
      `
      INSERT INTO notifications (title, message, type, recipient_id, expires_at, action_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, message, type, is_read as "isRead", 
                created_at as "createdAt", expires_at as "expiresAt", 
                action_url as "actionUrl"
      `,
      [title, message, type, recipientId, expiresAt, actionUrl],
    )

    return NextResponse.json(result[0], { status: 201 })
  } catch (error) {
    console.error("Error creating notification:", error)
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 })
  }
}

// DELETE handler to clear all notifications
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = (session.user as any).id

    // Delete all notifications for the user
    await sql(`DELETE FROM notifications WHERE recipient_id = $1`, [userId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error clearing notifications:", error)
    return NextResponse.json({ error: "Failed to clear notifications" }, { status: 500 })
  }
}
