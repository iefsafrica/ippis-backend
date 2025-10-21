import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

// Make this route dynamic to avoid caching
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Direct SQL commands to clear tables
    const clearCommands = [
      "TRUNCATE TABLE IF EXISTS pending_employees CASCADE;",
      "TRUNCATE TABLE IF EXISTS employees CASCADE;",
      "TRUNCATE TABLE IF EXISTS documents CASCADE;",
      "TRUNCATE TABLE IF EXISTS activities CASCADE;",
      "TRUNCATE TABLE IF EXISTS settings CASCADE;",
      "TRUNCATE TABLE IF EXISTS backups CASCADE;",
      "TRUNCATE TABLE IF EXISTS registrations CASCADE;",
      "TRUNCATE TABLE IF EXISTS personal_info CASCADE;",
      "TRUNCATE TABLE IF EXISTS employment_info CASCADE;",
      "TRUNCATE TABLE IF EXISTS document_uploads CASCADE;",
      "TRUNCATE TABLE IF EXISTS registration_history CASCADE;",
      "TRUNCATE TABLE IF EXISTS notifications CASCADE;",
      "TRUNCATE TABLE IF EXISTS password_resets CASCADE;",
      "TRUNCATE TABLE IF EXISTS help_articles CASCADE;",
      "TRUNCATE TABLE IF EXISTS help_categories CASCADE;",
    ]

    // Execute each command
    for (const command of clearCommands) {
      try {
        await sql`${command}`
        console.log(`Executed: ${command}`)
      } catch (err) {
        console.log(`Skipping command (table might not exist): ${command}`)
        // Continue with other commands
      }
    }

    return NextResponse.json({
      success: true,
      message: "Successfully cleared all tables",
    })
  } catch (error) {
    console.error("Error executing clear script:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to clear tables",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
