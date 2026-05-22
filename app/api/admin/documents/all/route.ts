// app/api/admin/documents/all/route.ts
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * GET /api/admin/documents/all
 * Returns every row from the `document_uploads` table.
 */
export async function GET(req: NextRequest) {
  try {
    const rows = await sql`
      SELECT
        id as document_id,
        registration_id,
        appointment_letter_path,
        educational_certificates_path,
        profile_image_path,
        signature_path,
        status,
        upload_date
      FROM document_uploads
      ORDER BY upload_date DESC NULLS LAST
    `;

    const result = rows.map((r: any) => ({
      documentId: r.document_id ?? null,
      registrationId: r.registration_id ?? null,
      appointmentLetter: r.appointment_letter_path ?? null,
      educationalCertificates: r.educational_certificates_path ?? null,
      profileImage: r.profile_image_path ?? null,
      signature: r.signature_path ?? null,
      status: r.status ?? null,
      uploadedAt: r.upload_date ? new Date(r.upload_date).toISOString() : null,
    }));

    return withCors(
      req,
      {
        success: true,
        data: result,
      },
      200
    );
  } catch (error) {
    console.error("Error fetching all documents:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch documents",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
