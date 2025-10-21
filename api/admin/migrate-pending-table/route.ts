import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

// Handler for both GET and POST requests
async function handleMigration() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL environment variable is not defined" },
        { status: 500 },
      )
    }

    const sql = neon(process.env.DATABASE_URL)

    // Check if the columns already exist
    const surnameColumnExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
        AND column_name = 'surname'
      );
    `

    if (surnameColumnExists[0].exists) {
      return NextResponse.json({
        success: true,
        message: "Columns already exist",
        status: "existing",
      })
    }

    // Add the new columns
    await sql`
      ALTER TABLE pending_employees 
      ADD COLUMN surname TEXT,
      ADD COLUMN firstname TEXT
    `

    // Update existing records to populate the new columns from name or metadata
    await sql`
      UPDATE pending_employees
      SET 
        surname = CASE 
          WHEN metadata->>'surname' IS NOT NULL THEN metadata->>'surname'
          WHEN metadata->>'lastName' IS NOT NULL THEN metadata->>'lastName'
          WHEN metadata->>'familyName' IS NOT NULL THEN metadata->>'familyName'
          ELSE split_part(name, ' ', 1)
        END,
        firstname = CASE
          WHEN metadata->>'firstname' IS NOT NULL THEN metadata->>'firstname'
          WHEN metadata->>'firstName' IS NOT NULL THEN metadata->>'firstName'
          WHEN metadata->>'givenName' IS NOT NULL THEN metadata->>'givenName'
          ELSE split_part(name, ' ', 2)
        END
      WHERE surname IS NULL OR firstname IS NULL
    `

    return NextResponse.json({
      success: true,
      message: "Table updated with surname and firstname columns and existing data migrated",
      status: "migrated",
    })
  } catch (error) {
    console.error("Error migrating pending_employees table:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to migrate pending_employees table",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// Handle GET requests
export async function GET() {
  return handleMigration()
}

// Handle POST requests
export async function POST() {
  return handleMigration()
}
