import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

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

    // Check if admin_permissions table exists
    try {
      await sql`SELECT 1 FROM admin_permissions LIMIT 1;`
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Database tables not set up. Please run database setup first.",
        },
        { status: 400 },
      )
    }

    // Check if permissions already exist
    const existingPermissions = await sql`SELECT COUNT(*) as count FROM admin_permissions;`
    if (existingPermissions[0].count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Permissions already set up. Cannot run setup again.",
        },
        { status: 400 },
      )
    }

    // Define permissions for superadmin
    const superadminPermissions = [
      { resource: "employees", action: "create", isAllowed: true },
      { resource: "employees", action: "read", isAllowed: true },
      { resource: "employees", action: "update", isAllowed: true },
      { resource: "employees", action: "delete", isAllowed: true },
      { resource: "documents", action: "read", isAllowed: true },
      { resource: "documents", action: "verify", isAllowed: true },
      { resource: "documents", action: "reject", isAllowed: true },
      { resource: "settings", action: "read", isAllowed: true },
      { resource: "settings", action: "update", isAllowed: true },
      { resource: "admin_users", action: "create", isAllowed: true },
      { resource: "admin_users", action: "read", isAllowed: true },
      { resource: "admin_users", action: "update", isAllowed: true },
      { resource: "admin_users", action: "delete", isAllowed: true },
      { resource: "backups", action: "create", isAllowed: true },
      { resource: "backups", action: "read", isAllowed: true },
      { resource: "backups", action: "restore", isAllowed: true },
      { resource: "backups", action: "delete", isAllowed: true },
      { resource: "reports", action: "generate", isAllowed: true },
      { resource: "reports", action: "export", isAllowed: true },
    ]

    // Define permissions for admin
    const adminPermissions = [
      { resource: "employees", action: "create", isAllowed: true },
      { resource: "employees", action: "read", isAllowed: true },
      { resource: "employees", action: "update", isAllowed: true },
      { resource: "employees", action: "delete", isAllowed: false },
      { resource: "documents", action: "read", isAllowed: true },
      { resource: "documents", action: "verify", isAllowed: true },
      { resource: "documents", action: "reject", isAllowed: true },
      { resource: "settings", action: "read", isAllowed: true },
      { resource: "settings", action: "update", isAllowed: false },
      { resource: "admin_users", action: "create", isAllowed: false },
      { resource: "admin_users", action: "read", isAllowed: true },
      { resource: "admin_users", action: "update", isAllowed: false },
      { resource: "admin_users", action: "delete", isAllowed: false },
      { resource: "backups", action: "create", isAllowed: true },
      { resource: "backups", action: "read", isAllowed: true },
      { resource: "backups", action: "restore", isAllowed: false },
      { resource: "backups", action: "delete", isAllowed: false },
      { resource: "reports", action: "generate", isAllowed: true },
      { resource: "reports", action: "export", isAllowed: true },
    ]

    // Define permissions for viewer
    const viewerPermissions = [
      { resource: "employees", action: "create", isAllowed: false },
      { resource: "employees", action: "read", isAllowed: true },
      { resource: "employees", action: "update", isAllowed: false },
      { resource: "employees", action: "delete", isAllowed: false },
      { resource: "documents", action: "read", isAllowed: true },
      { resource: "documents", action: "verify", isAllowed: false },
      { resource: "documents", action: "reject", isAllowed: false },
      { resource: "settings", action: "read", isAllowed: true },
      { resource: "settings", action: "update", isAllowed: false },
      { resource: "admin_users", action: "create", isAllowed: false },
      { resource: "admin_users", action: "read", isAllowed: false },
      { resource: "admin_users", action: "update", isAllowed: false },
      { resource: "admin_users", action: "delete", isAllowed: false },
      { resource: "backups", action: "create", isAllowed: false },
      { resource: "backups", action: "read", isAllowed: true },
      { resource: "backups", action: "restore", isAllowed: false },
      { resource: "backups", action: "delete", isAllowed: false },
      { resource: "reports", action: "generate", isAllowed: true },
      { resource: "reports", action: "export", isAllowed: false },
    ]

    // Insert superadmin permissions
    for (const perm of superadminPermissions) {
      await sql`
        INSERT INTO admin_permissions (role, resource, action, is_allowed)
        VALUES ('superadmin', ${perm.resource}, ${perm.action}, ${perm.isAllowed});
      `
    }

    // Insert admin permissions
    for (const perm of adminPermissions) {
      await sql`
        INSERT INTO admin_permissions (role, resource, action, is_allowed)
        VALUES ('admin', ${perm.resource}, ${perm.action}, ${perm.isAllowed});
      `
    }

    // Insert viewer permissions
    for (const perm of viewerPermissions) {
      await sql`
        INSERT INTO admin_permissions (role, resource, action, is_allowed)
        VALUES ('viewer', ${perm.resource}, ${perm.action}, ${perm.isAllowed});
      `
    }

    // Log the setup activity
    await sql`
      INSERT INTO activities (action, entity_type, entity_id, description, performed_by)
      VALUES ('setup', 'permissions', 'system', 'Default permissions created', 'system');
    `

    return NextResponse.json({
      success: true,
      message: "Permissions setup completed successfully",
    })
  } catch (error) {
    console.error("Permissions setup error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up permissions",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
