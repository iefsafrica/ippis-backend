import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth-options"

export async function GET() {
  const session = await getServerSession(authOptions)
//   if (!session?.user) {
//     return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
//   }

  try {
    const query = `
      SELECT 
        d.id,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
          ELSE 'Unknown Document'
        END AS name,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
          ELSE 'unknown'
        END AS type,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) AS employee_name,
        r.registration_id AS employee_id,
        d.status,
        d.upload_date
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE d.status = 'pending'
      ORDER BY d.upload_date DESC
      LIMIT 50
    `

    const result = await db.query(query)
    return NextResponse.json({
      success: true,
      data: result.rows,
      message: "Pending documents fetched successfully",
    })
  } catch (error) {
    console.error("Error fetching pending documents:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch pending documents",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
