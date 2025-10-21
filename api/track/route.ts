import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import prisma from "@/lib/generated/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const registrationId = searchParams.get("id")
    const email = searchParams.get("email")

    if (!registrationId && !email) {
      return NextResponse.json(
        { error: "Missing registration ID or email" },
        { status: 400 }
      )
    }

    let query = ""
    let value: string | null = null

    if (registrationId) {
      query = "SELECT * FROM registrations WHERE registration_id = $1"
      value = registrationId
    } else if (email) {
      query = "SELECT * FROM registrations WHERE email = $1"
      value = email
    }

    const result = await db.query(query, [value])

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Registration not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    })
  } catch (error) {
    console.error("Track registration error:", error)
    return NextResponse.json(
      {
        error: "Failed to track registration",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
