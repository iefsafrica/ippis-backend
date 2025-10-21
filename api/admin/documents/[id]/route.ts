import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const documentId = params.id

    // Query to get document details
    const query = `
      SELECT 
        d.id,
        d.document_id as id,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN d.appointment_letter_path
          WHEN d.educational_certificates_path IS NOT NULL THEN d.educational_certificates_path
          WHEN d.promotion_letter_path IS NOT NULL THEN d.promotion_letter_path
          WHEN d.other_documents_path IS NOT NULL THEN d.other_documents_path
          WHEN d.profile_image_path IS NOT NULL THEN d.profile_image_path
          WHEN d.signature_path IS NOT NULL THEN d.signature_path
        END as file_url,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END as type,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END as name,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as employee_name,
        r.registration_id as employee_id,
        CASE 
          WHEN r.status = 'approved' THEN 'verified'
          WHEN r.status = 'rejected' THEN 'rejected'
          ELSE 'pending'
        END as status,
        d.upload_date,
        r.comments
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.id = $1
    `

    const result = await db.query(query, [documentId])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    })
  } catch (error) {
    console.error("Error fetching document:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch document",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
