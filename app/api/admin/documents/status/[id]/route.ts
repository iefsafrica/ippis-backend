import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
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

    if (result.length === 0) {
      return withCors(req, {
        success: true,
        uploaded: false,
        message: "User has not uploaded any documents",
        uploadedDocuments: 0,
        documents: {}
      });
    }

    const doc = result[0]!;

    // Build only the uploaded documents
    const uploadedDetails: Record<string, string> = {};

    if (doc.appointment_letter_path) {
      uploadedDetails.appointmentLetter = doc.appointment_letter_path;
    }
    if (doc.educational_certificates_path) {
      uploadedDetails.educationalCertificates = doc.educational_certificates_path;
    }
    if (doc.profile_image_path) {
      uploadedDetails.profileImage = doc.profile_image_path;
    }
    if (doc.signature_path) {
      uploadedDetails.signature = doc.signature_path;
    }

    const uploadedCount = Object.keys(uploadedDetails).length;

    return withCors(req, {
      success: true,
      uploaded: uploadedCount > 0,
      message:
        uploadedCount === 0
          ? "User has not uploaded any documents"
          : "Uploaded documents retrieved successfully",
      uploadedDocuments: uploadedCount,
      documents: uploadedDetails
    });
  } catch (error) {
    console.error("Error:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Server error",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
