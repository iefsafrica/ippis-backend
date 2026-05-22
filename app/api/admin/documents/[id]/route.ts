import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
const sql = neon(process.env.DATABASE_URL!)

// Handle preflight
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest)
}

// GET /api/admin/documents/[id]
export async function GET(req: Request, context: any) {
  try {
    const registrationId = context.params?.id

    if (!registrationId) {
      return withCors(
        req as unknown as NextRequest,
        { success: false, error: "registrationId (from URL) is required" },
        400
      )
    }

    const result = await sql`
      SELECT 
        registration_id,
        appointment_letter_path,
        educational_certificates_path,
        profile_image_path,
        signature_path,
        upload_date,
        status
      FROM document_uploads
      WHERE registration_id = ${registrationId}
      LIMIT 1
    `

    if (result.length === 0) {
      return withCors(
        req as unknown as NextRequest,
        { success: false, error: "No documents found for this employee" },
        404
      )
    }

    const doc = result[0]!

    return withCors(req as unknown as NextRequest, {
      success: true,
      data: {
        registrationId: doc.registration_id,
        documents: {
          appointmentLetter: doc.appointment_letter_path,
          educationalCertificates: doc.educational_certificates_path,
          profileImage: doc.profile_image_path,
          signature: doc.signature_path,
        },
        status: doc.status,
        uploadedAt: doc.upload_date,
      },
    })
  } catch (error) {
    console.error("Error fetching employee documents:", error)
    return withCors(
      req as unknown as NextRequest,
      {
        success: false,
        error: "Failed to fetch employee documents",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}
