import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const sql = neon(process.env.DATABASE_URL!)

  try {
    const registrationId = params.id
    const { comment } = await request.json()

    if (!comment || comment.trim() === "") {
      return NextResponse.json(
        {
          error: "Comment is required for rejection",
        },
        { status: 400 },
      )
    }

    // Check if registration exists and is pending approval
    const checkResult = await sql`
      SELECT status, r.registration_id, p.email, CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as name
      FROM registrations r
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE r.registration_id = ${registrationId}
    `

    if (checkResult.length === 0) {
      return NextResponse.json(
        {
          error: "Registration not found",
        },
        { status: 404 },
      )
    }

    if (checkResult[0].status !== "pending_approval") {
      return NextResponse.json(
        {
          error: "Registration is not pending approval",
        },
        { status: 400 },
      )
    }

    // Update registration status
    await sql`
      UPDATE registrations
      SET 
        status = 'rejected',
        rejected_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE registration_id = ${registrationId}
    `

    // Create registration_comments table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS registration_comments (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        author TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `

    // Add comment
    await sql`
      INSERT INTO registration_comments (
        registration_id,
        comment_text,
        author
      )
      VALUES (
        ${registrationId},
        ${comment},
        'Admin'
      )
    `

    // Create registration_history table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS registration_history (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        performed_by TEXT,
        performed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `

    // Add to history
    await sql`
      INSERT INTO registration_history (
        registration_id,
        action,
        details,
        performed_by
      )
      VALUES (
        ${registrationId},
        'rejected',
        ${`Registration rejected: ${comment}`},
        'Admin'
      )
    `

    // In a real application, send email notification to the applicant
    // This would typically use a service like SendGrid, Mailgun, etc.
    console.log(`Email notification would be sent to ${checkResult[0].email} about rejection`)

    return NextResponse.json({
      success: true,
      message: "Registration rejected successfully",
    })
  } catch (error) {
    console.error("Reject registration error:", error)
    return NextResponse.json(
      {
        error: "Failed to reject registration",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
