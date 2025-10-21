import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth-options"

export async function POST(request: Request, { params }: { params: { employeeId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const employeeId = params.employeeId
    const { comment } = await request.json()

    if (!comment || comment.trim() === "") {
      return NextResponse.json({ error: "Comment is required for document rejection" }, { status: 400 })
    }

    // Begin transaction
    await db.execute("BEGIN")

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

    await db.execute(updateRegQuery, [employeeId, `All documents rejected: ${comment}`])

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

    await db.execute(logActivityQuery, [
      employeeId,
      "all_documents_rejected",
      `All documents rejected with reason: ${comment}`,
      session.user.email,
    ])

    // Commit transaction
    await db.execute("COMMIT")

    // Return updated documents
    const getUpdatedDocsQuery = `
      SELECT 
        d.id,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END as name,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END as type,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as employee_name,
        r.registration_id as employee_id,
        'rejected' as status,
        d.upload_date
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE r.registration_id = $1
    `

    const updatedDocs = await db.execute(getUpdatedDocsQuery, [employeeId])

    return NextResponse.json({
      success: true,
      data: updatedDocs.rows,
      message: "All documents rejected successfully",
    })
  } catch (error) {
    // Rollback on error
    await db.execute("ROLLBACK")

    console.error("Error rejecting all documents:", error)
    return NextResponse.json(
      {
        error: "Failed to reject all documents",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
