import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    console.log("Fetching database tables...")
    const sql = neon(process.env.DATABASE_URL!)

    // Query to get all tables in the database
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `

    console.log("Executing query:", query)
    const result = await sql.query(query)
    const tables = result.rows.map((row) => row.table_name)
    console.log("Found tables:", tables)

    // Get column information for key tables
    const tableDetails = {}
    const keyTables = ["employees", "pending_employees", "documents", "document_uploads", "activities"]

    for (const table of tables) {
      if (keyTables.includes(table)) {
        try {
          const columnsQuery = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `

          const columnsResult = await sql.query(columnsQuery, [table])
          tableDetails[table] = columnsResult.rows

          // Count rows in the table
          const countQuery = `SELECT COUNT(*) FROM "${table}"`
          const countResult = await sql.query(countQuery)
          tableDetails[`${table}_count`] = countResult.rows[0].count
        } catch (tableError) {
          console.error(`Error getting details for table ${table}:`, tableError)
          tableDetails[`${table}_error`] = tableError instanceof Error ? tableError.message : "Unknown error"
        }
      }
    }

    return NextResponse.json({
      success: true,
      tables,
      details: tableDetails,
    })
  } catch (error) {
    console.error("Error fetching database tables:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch database tables",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
