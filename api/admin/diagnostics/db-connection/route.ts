import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Simple query to test connection
    const result = await sql`SELECT 1 as connection_test`

    if (result && result[0] && result[0].connection_test === 1) {
      return NextResponse.json({
        success: true,
        message: "Database connection successful",
        timestamp: new Date().toISOString(),
        database_url: process.env.DATABASE_URL
          ? `${process.env.DATABASE_URL.split("@")[0].substring(0, 15)}...`
          : "Not available",
      })
    } else {
      throw new Error("Unexpected response from database")
    }
  } catch (error) {
    console.error("Database connection test failed:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Database connection failed",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
