import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function GET(request: Request) {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Check if the pending_employees table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `

    const tableExists = await sql.query(tableExistsQuery)

    if (!tableExists[0].exists) {
      return NextResponse.json({
        success: false,
        error: "The pending_employees table does not exist.",
        tableExists: false,
      })
    }

    // Get table structure
    const tableStructureQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'pending_employees'
      ORDER BY ordinal_position;
    `

    const tableStructure = await sql.query(tableStructureQuery)

    // Count records
    const countQuery = `SELECT COUNT(*) as count FROM pending_employees;`
    const countResult = await sql.query(countQuery)

    // Get sample records (limited to 5)
    const sampleQuery = `
      SELECT * FROM pending_employees
      LIMIT 5;
    `
    const sampleRecords = await sql.query(sampleQuery)

    return NextResponse.json({
      success: true,
      data: {
        tableExists: true,
        tableStructure: tableStructure,
        recordCount: countResult[0].count,
        sampleRecords: sampleRecords,
      },
    })
  } catch (error) {
    console.error("Diagnostics error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to run diagnostics",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
