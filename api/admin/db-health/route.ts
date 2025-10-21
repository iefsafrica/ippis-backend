import { NextResponse } from "next/server"
import { testConnection } from "@/lib/db-connection"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await testConnection()

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        timestamp: result.timestamp,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Error in database health check:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
