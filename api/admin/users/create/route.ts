import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"
import { hashPassword } from "@/lib/password-utils"
import { withRole } from "@/middleware/auth-middleware"

async function handler(request: Request, user: any) {
  try {
    const { username, email, password, fullName, role } = await request.json()

    // Validate input
    if (!username || !email || !password || !fullName || !role) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 })
    }

    // Check if username or email already exists
    const checkResult = await pool.query("SELECT id FROM admin_users WHERE username = $1 OR email = $2", [
      username,
      email,
    ])

    if (checkResult.rowCount > 0) {
      return NextResponse.json({ error: "Username or email already exists" }, { status: 400 })
    }

    // Hash the password
    const passwordHash = await hashPassword(password)

    // Insert the new user
    const result = await pool.query(
      `INSERT INTO admin_users 
       (username, email, password_hash, full_name, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email, role, full_name, created_at`,
      [username, email, passwordHash, fullName, role],
    )

    const newUser = result.rows[0]

    // Log the action
    await pool.query(
      "INSERT INTO activities (user_id, action_type, description, target_id, target_type) VALUES ($1, $2, $3, $4, $5)",
      [user.id, "CREATE_USER", `Created new admin user: ${username}`, newUser.id, "admin_user"],
    )

    return NextResponse.json({
      success: true,
      user: newUser,
    })
  } catch (error) {
    console.error("Create user error:", error)
    return NextResponse.json({ error: "An error occurred while creating the user" }, { status: 500 })
  }
}

// Only superadmins can create users
export const POST = withRole(handler, ["superadmin"])
