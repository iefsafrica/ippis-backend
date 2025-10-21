import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import bcrypt from "bcryptjs"

export async function POST(request: Request) {
  try {
    // Verify authorization token
    const authHeader = request.headers.get("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.split(" ")[1]
    if (token !== process.env.ADMIN_SETUP_TOKEN) {
      return NextResponse.json({ error: "Invalid setup token" }, { status: 403 })
    }

    const sql = neon(process.env.DATABASE_URL!)

    // Check if admin_users table exists
    try {
      await sql`SELECT 1 FROM admin_users LIMIT 1;`
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Database tables not set up. Please run database setup first.",
        },
        { status: 400 },
      )
    }

    // Check if users already exist
    const existingUsers = await sql`SELECT COUNT(*) as count FROM admin_users;`
    if (existingUsers[0].count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Users already set up. Cannot run setup again.",
        },
        { status: 400 },
      )
    }

    // Generate password hash for default admin
    const defaultPassword = "admin123" // In production, use a secure random password
    const passwordHash = await bcrypt.hash(defaultPassword, 10)

    // Create default superadmin user
    await sql`
      INSERT INTO admin_users (username, email, password_hash, full_name, role)
      VALUES ('admin', 'admin@ippis.gov.ng', ${passwordHash}, 'System Administrator', 'superadmin');
    `

    // Create default admin user
    const adminPasswordHash = await bcrypt.hash("manager123", 10)
    await sql`
      INSERT INTO admin_users (username, email, password_hash, full_name, role)
      VALUES ('manager', 'manager@ippis.gov.ng', ${adminPasswordHash}, 'System Manager', 'admin');
    `

    // Create default viewer user
    const viewerPasswordHash = await bcrypt.hash("viewer123", 10)
    await sql`
      INSERT INTO admin_users (username, email, password_hash, full_name, role)
      VALUES ('viewer', 'viewer@ippis.gov.ng', ${viewerPasswordHash}, 'System Viewer', 'viewer');
    `

    // Log the setup activity
    await sql`
      INSERT INTO activities (action, entity_type, entity_id, description, performed_by)
      VALUES ('setup', 'users', 'system', 'Default users created', 'system');
    `

    return NextResponse.json({
      success: true,
      message: "User setup completed successfully",
      defaultCredentials: [
        { username: "admin", password: defaultPassword, role: "superadmin" },
        { username: "manager", password: "manager123", role: "admin" },
        { username: "viewer", password: "viewer123", role: "viewer" },
      ],
    })
  } catch (error) {
    console.error("User setup error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up users",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
