import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

export async function POST() {
  try {
    // Create tables if they don't exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        position TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        join_date TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB
      );

      CREATE TABLE IF NOT EXISTS pending_employees (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        department TEXT NOT NULL,
        position TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        source TEXT NOT NULL DEFAULT 'form',
        submission_date TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        missing_fields JSONB,
        metadata JSONB
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        document_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        employee_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        upload_date TIMESTAMP NOT NULL DEFAULT NOW(),
        verified_date TIMESTAMP,
        rejected_date TIMESTAMP,
        verified_by TEXT,
        rejected_by TEXT,
        comments TEXT,
        file_url TEXT,
        file_type TEXT,
        file_size INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        description TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB
      );

      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        description TEXT,
        updated_by TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        backup_id TEXT NOT NULL UNIQUE,
        name TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        size TEXT,
        location TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB
      );
    `)

    // Insert default settings
    await db.execute(sql`
      INSERT INTO settings (key, value, description, updated_by)
      VALUES 
        ('system_name', 'IPPIS Admin Portal', 'Name of the system', 'system'),
        ('email_notifications', 'true', 'Enable email notifications', 'system'),
        ('document_verification_required', 'true', 'Require document verification before approval', 'system'),
        ('auto_backup_enabled', 'true', 'Enable automatic database backups', 'system'),
        ('auto_backup_frequency', 'daily', 'Frequency of automatic backups', 'system')
      ON CONFLICT (key) DO NOTHING;
    `)

    return NextResponse.json({
      success: true,
      message: "Database initialized successfully",
    })
  } catch (error) {
    console.error("Failed to initialize database:", error)
    return NextResponse.json({ success: false, error: "Failed to initialize database" }, { status: 500 })
  }
}
