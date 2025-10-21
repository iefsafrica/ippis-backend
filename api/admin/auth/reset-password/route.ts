import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"
import { hashPassword } from "@/lib/password-utils"
import crypto from "crypto"

export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    // Validate input
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Check if the user exists
    const userResult = await pool.query("SELECT id, username FROM admin_users WHERE email = $1", [email])

    if (userResult.rowCount === 0) {
      // For security reasons, don't reveal that the email doesn't exist
      return NextResponse.json({
        success: true,
        message: "If your email is registered, you will receive password reset instructions",
      })
    }

    const user = userResult.rows[0]

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString("hex")
    const tokenExpiry = new Date()
    tokenExpiry.setHours(tokenExpiry.getHours() + 1) // Token valid for 1 hour

    // Store the reset token
    await pool.query(
      `INSERT INTO password_reset_tokens 
       (user_id, token, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET token = $2, expires_at = $3, created_at = CURRENT_TIMESTAMP`,
      [user.id, resetToken, tokenExpiry],
    )

    // In a real application, send an email with the reset link
    // For this example, we'll just return the token
    console.log(`Password reset requested for ${email}. Token: ${resetToken}`)

    return NextResponse.json({
      success: true,
      message: "If your email is registered, you will receive password reset instructions",
      // In a real app, don't return the token in the response
      // This is just for demonstration purposes
      debug: {
        resetToken,
        resetUrl: `${process.env.NEXT_PUBLIC_API_BASE_URL}/admin/reset-password?token=${resetToken}`,
      },
    })
  } catch (error) {
    console.error("Password reset request error:", error)
    return NextResponse.json({ error: "An error occurred while processing your request" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { token, newPassword } = await request.json()

    // Validate input
    if (!token || !newPassword) {
      return NextResponse.json({ error: "Token and new password are required" }, { status: 400 })
    }

    // Check if the token exists and is valid
    const tokenResult = await pool.query(
      `SELECT user_id, expires_at FROM password_reset_tokens 
       WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [token],
    )

    if (tokenResult.rowCount === 0) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 })
    }

    const { user_id, expires_at } = tokenResult.rows[0]

    // Hash the new password
    const passwordHash = await hashPassword(newPassword)

    // Update the user's password
    await pool.query("UPDATE admin_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [
      passwordHash,
      user_id,
    ])

    // Delete the used token
    await pool.query("DELETE FROM password_reset_tokens WHERE token = $1", [token])

    // Log the action
    await pool.query("INSERT INTO activities (user_id, action_type, description) VALUES ($1, $2, $3)", [
      user_id,
      "PASSWORD_RESET",
      "Password was reset using a reset token",
    ])

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully",
    })
  } catch (error) {
    console.error("Password reset error:", error)
    return NextResponse.json({ error: "An error occurred while resetting your password" }, { status: 500 })
  }
}
