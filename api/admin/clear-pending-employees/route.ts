import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST(request: Request) {
  try {
    console.log("Clearing pending employees table...")

    // Check if DATABASE_URL is configured
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not configured")
    }

    const sql = neon(process.env.DATABASE_URL)

    // First check if the table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `

    if (!tableExists[0].exists) {
      return NextResponse.json(
        {
          success: false,
          error: "The pending_employees table does not exist in the database",
        },
        { status: 404 },
      )
    }

    // Use TRUNCATE to clear the table
    await sql`TRUNCATE TABLE pending_employees CASCADE;`

    console.log("Successfully cleared pending employees table")

    return NextResponse.json({
      success: true,
      message: "Successfully cleared all pending employees data",
    })
  } catch (error) {
    console.error("Error clearing pending employees:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to clear pending employees data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
