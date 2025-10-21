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

    // Create admin users table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'admin',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `

    // Create admin sessions table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(50),
        user_agent TEXT,
        FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );
    `

    // Create dashboard notifications table
    await sql`
      CREATE TABLE IF NOT EXISTS dashboard_notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        recipient_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        action_url TEXT,
        FOREIGN KEY (recipient_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );
    `

    // Create dashboard widgets configuration
    await sql`
      CREATE TABLE IF NOT EXISTS dashboard_widgets (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        widget_type VARCHAR(50) NOT NULL,
        widget_position INTEGER NOT NULL,
        widget_size VARCHAR(20) NOT NULL DEFAULT 'medium',
        widget_config JSONB NOT NULL DEFAULT '{}',
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );
    `

    // Create admin permissions table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_permissions (
        id SERIAL PRIMARY KEY,
        role VARCHAR(20) NOT NULL,
        resource VARCHAR(50) NOT NULL,
        action VARCHAR(20) NOT NULL,
        is_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, resource, action)
      );
    `

    // Create employees table
    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        department VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        join_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
    `

    // Create pending employees table
    await sql`
      CREATE TABLE IF NOT EXISTS pending_employees (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        department VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
        source VARCHAR(50) NOT NULL DEFAULT 'form',
        submission_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        missing_fields JSONB,
        metadata JSONB
      );
    `

    // Create documents table
    await sql`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        document_id VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        employee_id VARCHAR(20) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        upload_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_date TIMESTAMP,
        rejected_date TIMESTAMP,
        verified_by VARCHAR(100),
        rejected_by VARCHAR(100),
        comments TEXT,
        file_url TEXT,
        file_type VARCHAR(50),
        file_size INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `

    // Create activities table
    await sql`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        performed_by VARCHAR(100) NOT NULL,
        performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
    `

    // Create settings table
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        description TEXT,
        updated_by VARCHAR(100),
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `

    // Create backups table
    await sql`
      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        backup_id VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100),
        type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        size VARCHAR(20),
        location TEXT NOT NULL,
        created_by VARCHAR(100),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
    `

    // Insert default settings
    await sql`
      INSERT INTO settings (key, value, description, updated_by)
      VALUES 
        ('system_name', 'IPPIS Admin Portal', 'Name of the system', 'system'),
        ('email_notifications', 'true', 'Enable email notifications', 'system'),
        ('document_verification_required', 'true', 'Require document verification before approval', 'system'),
        ('auto_backup_enabled', 'true', 'Enable automatic database backups', 'system'),
        ('auto_backup_frequency', 'daily', 'Frequency of automatic backups', 'system')
      ON CONFLICT (key) DO NOTHING;
    `

    // Log the setup activity
    await sql`
      INSERT INTO activities (action, entity_type, entity_id, description, performed_by)
      VALUES ('setup', 'database', 'system', 'Initial database setup completed', 'system');
    `

    return NextResponse.json({
      success: true,
      message: "Database setup completed successfully",
    })
  } catch (error) {
    console.error("Database setup error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up database",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
