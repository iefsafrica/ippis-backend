import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"

export async function GET() {
  try {
    // Check database connection
    const dbResult = await pool.query("SELECT NOW()")
    const dbTime = dbResult.rows[0].now

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        timestamp: dbTime,
      },
      environment: process.env.NODE_ENV,
      apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ? "configured" : "not configured",
    })
  } catch (error) {
    console.error("Health check failed:", error)

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        environment: process.env.NODE_ENV,
      },
      { status: 500 },
    )
  }
}
