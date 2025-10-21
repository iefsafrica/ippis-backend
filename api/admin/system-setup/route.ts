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

    // Check if settings table exists
    try {
      await sql`SELECT 1 FROM settings LIMIT 1;`
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Database tables not set up. Please run database setup first.",
        },
        { status: 400 },
      )
    }

    // Update or insert system settings
    const systemSettings = [
      {
        key: "system_name",
        value: "IPPIS Admin Portal",
        description: "Name of the system",
      },
      {
        key: "system_version",
        value: "1.0.0",
        description: "Current system version",
      },
      {
        key: "email_notifications",
        value: "true",
        description: "Enable email notifications",
      },
      {
        key: "email_from",
        value: "noreply@ippis.gov.ng",
        description: "Default sender email address",
      },
      {
        key: "document_verification_required",
        value: "true",
        description: "Require document verification before approval",
      },
      {
        key: "auto_backup_enabled",
        value: "true",
        description: "Enable automatic database backups",
      },
      {
        key: "auto_backup_frequency",
        value: "daily",
        description: "Frequency of automatic backups",
      },
      {
        key: "auto_backup_retention",
        value: "30",
        description: "Number of days to retain automatic backups",
      },
      {
        key: "session_timeout",
        value: "30",
        description: "Session timeout in minutes",
      },
      {
        key: "max_login_attempts",
        value: "5",
        description: "Maximum failed login attempts before account lockout",
      },
      {
        key: "account_lockout_duration",
        value: "15",
        description: "Account lockout duration in minutes",
      },
      {
        key: "password_expiry_days",
        value: "90",
        description: "Number of days before password expires",
      },
      {
        key: "system_timezone",
        value: "Africa/Lagos",
        description: "System timezone",
      },
      {
        key: "maintenance_mode",
        value: "false",
        description: "System maintenance mode",
      },
    ]

    // Update or insert each setting
    for (const setting of systemSettings) {
      await sql`
        INSERT INTO settings (key, value, description, updated_by)
        VALUES (${setting.key}, ${setting.value}, ${setting.description}, 'system')
        ON CONFLICT (key) 
        DO UPDATE SET 
          value = ${setting.value},
          description = ${setting.description},
          updated_by = 'system',
          updated_at = CURRENT_TIMESTAMP;
      `
    }

    // Log the setup activity
    await sql`
      INSERT INTO activities (action, entity_type, entity_id, description, performed_by)
      VALUES ('setup', 'system', 'system', 'System settings configured', 'system');
    `

    return NextResponse.json({
      success: true,
      message: "System setup completed successfully",
    })
  } catch (error) {
    console.error("System setup error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up system",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
