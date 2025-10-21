import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const userId = params.id

    // Query the database for the user
    const result = await pool.query(
      "SELECT id, username, email, role, created_at, last_login FROM admin_users WHERE id = $1",
      [userId],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const user = result.rows[0]

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
        lastLogin: user.last_login,
      },
    })
  } catch (error) {
    console.error("Error fetching user profile:", error)
    return NextResponse.json({ error: "Failed to fetch user profile" }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const userId = params.id
    const { name, email } = await request.json()

    // Validate input
    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
    }

    // Update the user in the database
    await pool.query("UPDATE admin_users SET username = $1, email = $2 WHERE id = $3", [name, email, userId])

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
    })
  } catch (error) {
    console.error("Error updating user profile:", error)
    return NextResponse.json({ error: "Failed to update user profile" }, { status: 500 })
  }
}
