// app/api/admin/employees/documents/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function GET(req: NextRequest) {
  try {
    const employees = await sql`
      SELECT 
        e.registration_id,
        e.surname,
        e.firstname,
        d.appointment_letter_path,
        d.educational_certificates_path,
        d.profile_image_path,
        d.signature_path,
        d.status AS document_status,
        d.upload_date
      FROM pending_employees e
      LEFT JOIN document_uploads d
        ON e.registration_id = d.registration_id
      WHERE e.status = 'pending_approval'
      ORDER BY d.upload_date DESC NULLS LAST
    `

    const result = employees.map(emp => ({
      registrationId: emp.registration_id,
      name: `${emp.firstname} ${emp.surname}`,
      documents: {
        appointmentLetter: emp.appointment_letter_path,
        educationalCertificates: emp.educational_certificates_path,
        profileImage: emp.profile_image_path,
        signature: emp.signature_path
      },
      status: emp.document_status,
      uploadedAt: emp.upload_date
    }))

    return withCors(req, {
      success: true,
      data: result
    })
  } catch (error) {
    console.error("Error fetching employee documents:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch employee documents",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}
