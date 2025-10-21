import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth-options"
import { sendDocumentStatusEmail } from "@/lib/email"

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  // if (!session?.user) {
  //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // }

  const documentId = params.id
  const { comment }: { comment?: string } = await request.json()

  if (!comment || comment.trim() === "") {
    return NextResponse.json(
      { error: "Comment is required for document rejection" },
      { status: 400 }
    )
  }

  try {
    await db.query("BEGIN")

    // Fetch document and registration_id
    const getDocQuery = `
      SELECT d.*, r.registration_id, p.email, CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as full_name
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.id = $1
    `
    const docResult = await db.query(getDocQuery, [documentId])

    if (docResult.rows.length === 0) {
      await db.query("ROLLBACK")
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const document = docResult.rows[0]
    const registrationId = document.registration_id

    // Update registration status to rejected
    const updateRegQuery = `
      UPDATE registrations
      SET status = 'rejected',
          rejected_at = NOW(),
          comments = CASE 
            WHEN comments IS NULL THEN $2
            ELSE comments || E'\\n' || $2
          END,
          updated_at = NOW()
      WHERE registration_id = $1
      RETURNING *
    `
    await db.query(updateRegQuery, [registrationId, `Document rejected: ${comment}`])

    // Log rejection activity
    const logActivityQuery = `
      INSERT INTO registration_history (
        registration_id,
        action,
        details,
        performed_by,
        performed_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `
    await db.query(logActivityQuery, [
      registrationId,
      "document_rejected",
      `Document rejected with reason: ${comment}`,
      session.user.email,
    ])

    await db.query("COMMIT")

    // Send rejection email notification
    try {
      await sendDocumentStatusEmail({
        to: document.email,
        status: "rejected",
        comment,
      })
    } catch (emailError) {
      console.error("Failed to send rejection email:", emailError)
      // Optional: continue silently or handle further
    }

    // Return updated document info
    const getUpdatedDocQuery = `
      SELECT 
        d.id,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END AS name,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END AS type,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) AS employee_name,
        r.registration_id AS employee_id,
        'rejected' AS status,
        d.upload_date
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.id = $1
    `
    const updatedDoc = await db.query(getUpdatedDocQuery, [documentId])

    return NextResponse.json({
      success: true,
      data: updatedDoc.rows[0],
      message: "Document rejected successfully",
    })
  } catch (error) {
    await db.query("ROLLBACK")
    console.error("Error rejecting document:", error)

    return NextResponse.json(
      {
        error: "Failed to reject document",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}