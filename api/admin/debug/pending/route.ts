import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const diagnostics = {
    databaseUrl: process.env.DATABASE_URL ? "Defined" : "Not defined",
    connectionTest: null,
    tableExists: null,
    error: null,
    success: false,
    timestamp: new Date().toISOString(),
  }

  try {
    // Check if DATABASE_URL is defined
    if (!process.env.DATABASE_URL) {
      diagnostics.error = "DATABASE_URL environment variable is not defined"
      return NextResponse.json(diagnostics, { status: 500 })
    }

    // Test database connection
    try {
      const sql = neon(process.env.DATABASE_URL)
      const result = await sql`SELECT 1 as connection_test`
      diagnostics.connectionTest = result[0].connection_test === 1 ? "Success" : "Failed"
    } catch (connError) {
      diagnostics.connectionTest = "Failed"
      diagnostics.error = connError instanceof Error ? connError.message : String(connError)
      return NextResponse.json(diagnostics, { status: 500 })
    }

    // Check if the pending_employees table exists
    try {
      const sql = neon(process.env.DATABASE_URL)
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'pending_employees'
        );
      `
      diagnostics.tableExists = result[0].exists ? "Yes" : "No"
    } catch (tableError) {
      diagnostics.tableExists = "Error checking"
      diagnostics.error = tableError instanceof Error ? tableError.message : String(tableError)
      return NextResponse.json(diagnostics, { status: 500 })
    }

    // All checks passed
    diagnostics.success = true
    return NextResponse.json(diagnostics)
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error)
    return NextResponse.json(diagnostics, { status: 500 })
  }
}
