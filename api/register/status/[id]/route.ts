import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const registrationId = params.id

    if (!registrationId) {
      return NextResponse.json(
        {
          error: "Missing registration ID",
        },
        { status: 400 },
      )
    }

    // Get registration data
    const registrationResult = await db.execute(`
      SELECT * FROM registrations WHERE registration_id = '${registrationId}'
    `)

    if (registrationResult.rows.length === 0) {
      return NextResponse.json(
        {
          error: "Registration not found",
        },
        { status: 404 },
      )
    }

    // Get all related data
    const [verificationResult, personalInfoResult, employmentInfoResult, documentsResult, historyResult] =
      await Promise.all([
        db.execute(`SELECT * FROM verification_data WHERE registration_id = '${registrationId}'`),
        db.execute(`SELECT * FROM personal_info WHERE registration_id = '${registrationId}'`),
        db.execute(`SELECT * FROM employment_info WHERE registration_id = '${registrationId}'`),
        db.execute(`SELECT * FROM document_uploads WHERE registration_id = '${registrationId}'`),
        db.execute(
          `SELECT * FROM registration_history WHERE registration_id = '${registrationId}' ORDER BY performed_at DESC`,
        ),
      ])

    return NextResponse.json({
      success: true,
      data: {
        registration: registrationResult.rows[0] || null,
        verification: verificationResult.rows[0] || null,
        personalInfo: personalInfoResult.rows[0] || null,
        employmentInfo: employmentInfoResult.rows[0] || null,
        documents: documentsResult.rows[0] || null,
        history: historyResult.rows || [],
      },
    })
  } catch (error) {
    console.error("Status check error:", error)
    return NextResponse.json(
      {
        error: "Failed to check registration status",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
