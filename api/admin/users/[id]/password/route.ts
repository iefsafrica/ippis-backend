import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"
import { comparePassword, hashPassword } from "@/lib/password-utils"

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const userId = params.id
    const { currentPassword, newPassword } = await request.json()

    // Validate input
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current password and new password are required" }, { status: 400 })
    }

    // Get the user from the database
    const userResult = await pool.query("SELECT password_hash FROM admin_users WHERE id = $1", [userId])

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const user = userResult.rows[0]

    // Verify the current password
    const isPasswordValid = await comparePassword(currentPassword, user.password_hash)

    if (!isPasswordValid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword)

    // Update the password in the database
    await pool.query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [hashedPassword, userId])

    // Log the password change
    try {
      await pool.query("INSERT INTO activities (user_id, action_type, description) VALUES ($1, $2, $3)", [
        userId,
        "PASSWORD_CHANGE",
        "User changed their password",
      ])
    } catch (error) {
      console.log("Could not log activity (table may not exist yet)")
    }

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
    })
  } catch (error) {
    console.error("Error changing password:", error)
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 })
  }
}
