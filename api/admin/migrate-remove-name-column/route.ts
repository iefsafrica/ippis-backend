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

    // Check if the name column exists
    const nameColumnExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
        AND column_name = 'name'
      );
    `

    if (!nameColumnExists[0].exists) {
      return NextResponse.json({
        success: true,
        message: "Name column already removed",
        status: "already_removed",
      })
    }

    // Check if surname and firstname columns exist
    const surnameColumnExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
        AND column_name = 'surname'
      );
    `

    const firstnameColumnExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
        AND column_name = 'firstname'
      );
    `

    // If surname or firstname columns don't exist, create them first
    if (!surnameColumnExists[0].exists || !firstnameColumnExists[0].exists) {
      if (!surnameColumnExists[0].exists) {
        await sql`ALTER TABLE pending_employees ADD COLUMN surname TEXT`
      }

      if (!firstnameColumnExists[0].exists) {
        await sql`ALTER TABLE pending_employees ADD COLUMN firstname TEXT`
      }

      // Populate surname and firstname from name
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
    }

    // Make surname and firstname NOT NULL
    await sql`
      UPDATE pending_employees
      SET 
        surname = COALESCE(surname, 'Unknown'),
        firstname = COALESCE(firstname, '')
      WHERE surname IS NULL OR firstname IS NULL
    `

    await sql`ALTER TABLE pending_employees ALTER COLUMN surname SET NOT NULL`
    await sql`ALTER TABLE pending_employees ALTER COLUMN firstname SET NOT NULL`

    // Remove the name column
    await sql`ALTER TABLE pending_employees DROP COLUMN name`

    return NextResponse.json({
      success: true,
      message: "Name column removed and surname/firstname columns are now required",
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
