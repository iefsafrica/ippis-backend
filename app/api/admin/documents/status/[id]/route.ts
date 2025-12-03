import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Preflight for Postman/browser
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest);
}

// GET /api/admin/documents/status/:id
export async function GET(req: Request, context: { params: { id: string } }) {
  try {
    const employeeId = context.params?.id;

    if (!employeeId) {
      return withCors(
        req as unknown as NextRequest,
        { success: false, error: "Employee ID is required" },
        400
      );
    }

    const result = await sql`
      SELECT 
        appointment_letter_path,
        educational_certificates_path,
        profile_image_path,
        signature_path
      FROM document_uploads
      WHERE registration_id = ${employeeId}
      LIMIT 1
    `;

    const totalDocuments = 4;
    // No record found = never uploaded
    if (result.length === 0) {
      return withCors(
        req as unknown as NextRequest,
        {
          success: true,
          uploaded: false,
          message: "User has not uploaded any documents",
          pendingUploads: totalDocuments,
          uploadedDocuments: 0,
          details: {
            appointmentLetter: false,
            educationalCertificates: false,
            profileImage: false,
            signature: false,
          },
        }
      );
    }

    const doc = result[0]!;

    // Count uploaded documents
    const uploadedDocuments = [
      doc.appointment_letter_path,
      doc.educational_certificates_path,
      doc.profile_image_path,
      doc.signature_path,
    ].filter(Boolean).length;

    const pending = totalDocuments - uploadedDocuments;

    return withCors(
      req as unknown as NextRequest,
      {
        success: true,
        uploaded: uploadedDocuments > 0,
        message:
          uploadedDocuments === totalDocuments
            ? "All documents uploaded"
            : uploadedDocuments === 0
            ? "User has not uploaded any documents"
            : "Some documents are still pending",
        uploadedDocuments,
        pendingUploads: pending,
        details: {
          appointmentLetter: !!doc.appointment_letter_path,
          educationalCertificates: !!doc.educational_certificates_path,
          profileImage: !!doc.profile_image_path,
          signature: !!doc.signature_path,
        },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return withCors(
      req as unknown as NextRequest,
      {
        success: false,
        error: "Server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
