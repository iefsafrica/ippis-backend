import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { format } from "date-fns"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "recent"
    const limit = Number.parseInt(searchParams.get("limit") || "10", 10)

    const sql = neon(process.env.DATABASE_URL!)

    let data: any[] = []

    // Check if tables exist before querying
    const tablesExist = await checkTablesExist(sql)

    if (tablesExist) {
      if (type === "recent") {
        // Get recently registered employees
        const query = `
          SELECT 
            id, 
            CONCAT(first_name, ' ', last_name) as name, 
            email, 
            department, 
            status, 
            created_at as date
          FROM employees
          WHERE status != 'deleted'
          ORDER BY created_at DESC
          LIMIT $1
        `
        const result = await sql.query(query, [limit])
data = result.map((row: any) => ({
  ...row,
  date: format(new Date(row.date), "MMM d, yyyy"),
}))
      } else if (type === "pending") {
        // Get pending employees from pending_employees table
        const query = `
          SELECT 
            id, 
            CONCAT(first_name, ' ', last_name) as name, 
            email, 
            department, 
            status, 
            created_at as date
          FROM pending_employees
          WHERE status = 'pending_approval'
          ORDER BY created_at DESC
          LIMIT $1
        `
       const result = await sql.query(query, [limit])
data = result.map((row: any) => ({
  ...row,
  date: format(new Date(row.date), "MMM d, yyyy"),
}))
      }
    }

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    console.error("Error fetching recent employees:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch recent employees",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Helper function to check if required tables exist
async function checkTablesExist(sql: any) {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'employees'
      ) as employees_exist,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'pending_employees'
      ) as pending_employees_exist
    `

    const result = await sql.query(query)

    if (!result || !result.rows) {
      console.warn("Unexpected query result format:", result)
      return false
    }

    if (result.rows.length === 0) return false

    const { employees_exist, pending_employees_exist } = result.rows[0]

    // We need at least one of these tables to exist
    return employees_exist || pending_employees_exist
  } catch (error) {
    console.error("Error checking tables:", error)
    return false
  }
}