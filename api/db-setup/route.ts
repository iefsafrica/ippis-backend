import { NextResponse } from "next/server"
import { runMigrations } from "@/lib/db-connection"

// This is an admin-only endpoint to set up the database
export async function POST(request: Request) {
  try {
    // Check for admin authorization
    const authHeader = request.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.split(" ")[1]

    // In a real app, you would validate this token against your admin tokens
    if (token !== process.env.ADMIN_SETUP_TOKEN) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 })
    }

    // Run the migrations
    await runMigrations()

    return NextResponse.json({
      success: true,
      message: "Database setup completed successfully",
    })
  } catch (error) {
    console.error("Database setup error:", error)
    return NextResponse.json(
      {
        error: "Failed to set up database",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
