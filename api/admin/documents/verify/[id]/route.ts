import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth-options"
import { sendDocumentStatusEmail } from "@/lib/email"

export async function POST(
  request: Request,
  { params }: { params: { registration_id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const registrationId = params.registration_id
    const { comment, status = "approved" }: { comment?: string; status?: "approved" | "rejected" } =
      await request.json()

    // Begin transaction
    await db.query("BEGIN")

    // Get document by registration_id and user email
    const getDocQuery = `
      SELECT d.*, r.registration_id, p.email, CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as full_name
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.registration_id = $1
    `
    const docResult = await db.query(getDocQuery, [registrationId])

    if (docResult.rows.length === 0) {
      await db.query("ROLLBACK")
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const document = docResult.rows[0]

    // Update registration status
    const updateRegQuery = `
      UPDATE registrations
      SET status = $2, 
          approved_at = NOW(),
          comments = CASE 
            WHEN comments IS NULL THEN $3
            ELSE comments || E'\\n' || $3
          END,
          updated_at = NOW()
      WHERE registration_id = $1
      RETURNING *
    `
    await db.query(updateRegQuery, [
      registrationId,
      status,
      comment ? `Document ${status}: ${comment}` : `Document ${status}`,
    ])

    // Log activity
    const logActivityQuery = `
      INSERT INTO registration_history (
        registration_id, 
        action, 
        details, 
        performed_by, 
        performed_at
      )
      VALUES ($1, $2, $3, $4, NOW())
    `
    await db.query(logActivityQuery, [
      registrationId,
      `document_${status}`,
      comment ? `Document ${status} with comment: ${comment}` : `Document ${status}`,
      session.user.email,
    ])

    // Commit transaction
    await db.query("COMMIT")

    // Send email notification to user
    try {
      await sendDocumentStatusEmail({
        to: document.email,
        status,
        comment,
      })
    } catch (emailError) {
      console.error("Failed to send email notification:", emailError)
    }

    // Fetch updated document info to return
    const getUpdatedDocQuery = `
      SELECT 
        d.id,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as employee_name,
        r.registration_id as employee_id,
        $2 as status,
        d.upload_date
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.registration_id = $1
    `
    const updatedDoc = await db.query(getUpdatedDocQuery, [registrationId, status])

    return NextResponse.json({
      success: true,
      data: updatedDoc.rows[0],
      message: `Documents ${status} successfully`,
    })
  } catch (error) {
    await db.query("ROLLBACK")
    console.error("Error verifying document:", error)
    return NextResponse.json(
      {
        error: "Failed to verify document",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
