import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const data = await request.json()
    const { registrationId, declaration } = data

    if (!registrationId) {
      return NextResponse.json(
        {
          error: "Missing registration ID",
        },
        { status: 400 },
      )
    }

    if (!declaration) {
      return NextResponse.json(
        {
          error: "Declaration must be accepted",
        },
        { status: 400 },
      )
    }

    // Submit the registration
    await db.execute(`
      UPDATE registrations 
      SET 
        status = 'pending_approval',
        current_step = 'submitted',
        declaration = ${declaration},
        submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE registration_id = '${registrationId}'
    `)

    // Add to history
    await db.execute(`
      INSERT INTO registration_history (registration_id, action, details) 
      VALUES ('${registrationId}', 'submitted', 'Registration submitted for approval')
    `)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error("Submission error:", error)
    return NextResponse.json(
      {
        error: "Failed to submit registration",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
