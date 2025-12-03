import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Preflight
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest);
}

// GET /api/admin/documents/status/:id
export async function GET(req: NextRequest) {
  try {
    // Extract the id from the URL
    const { pathname } = req.nextUrl;
    // Assuming the path is /api/admin/documents/status/<id>
    const parts = pathname.split("/");
    const employeeId = parts[parts.length - 1];

    if (!employeeId) {
      return withCors(
        req,
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

    if (result.length === 0) {
      return withCors(req, {
        success: true,
        uploaded: false,
        message: "User has not uploaded any documents",
        uploadedDocuments: 0,
        pendingUploads: totalDocuments,
        details: {
          appointmentLetter: false,
          educationalCertificates: false,
          profileImage: false,
          signature: false,
        },
      });
    }

    const doc = result[0]!;

    const uploadedDocuments = [
      doc.appointment_letter_path,
      doc.educational_certificates_path,
      doc.profile_image_path,
      doc.signature_path,
    ].filter(Boolean).length;

    const pending = totalDocuments - uploadedDocuments;

    return withCors(req, {
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
    });
  } catch (error) {
    console.error("Error:", error);
    return withCors(req, {
      success: false,
      error: "Server error",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
