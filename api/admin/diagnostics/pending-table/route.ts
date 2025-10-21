import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL environment variable is not defined" },
        { status: 500 },
      )
    }

    const sql = neon(process.env.DATABASE_URL)

    // Get table structure
    const tableColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'pending_employees'
      ORDER BY ordinal_position;
    `

    // Get sample data (first 5 rows)
    const sampleData = await sql`
      SELECT id, name, email, surname, firstname, metadata
      FROM pending_employees
      LIMIT 5;
    `

    return NextResponse.json({
      success: true,
      tableStructure: tableColumns,
      sampleData: sampleData,
    })
  } catch (error) {
    console.error("Error getting pending_employees table info:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get pending_employees table information",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
