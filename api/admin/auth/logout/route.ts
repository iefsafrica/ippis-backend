import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"
import { withAuth } from "@/middleware/auth-middleware"

async function handler(request: Request, user: any) {
  try {
    // Log the logout activity
    await pool.query("INSERT INTO activities (user_id, action, details) VALUES ($1, $2, $3)", [
      user.id,
      "LOGOUT",
      "Admin user logged out",
    ])

    return NextResponse.json({
      success: true,
      message: "Logged out successfully",
    })
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "An error occurred during logout" }, { status: 500 })
  }
}

export const POST = withAuth(handler)
