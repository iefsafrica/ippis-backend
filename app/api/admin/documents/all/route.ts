// app/api/admin/documents/all/route.ts
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";

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
    const auth = await requirePermission(req, "employees.documents.view");
    if (!auth.ok) return auth.response;

    // A document belongs to its employee's MDA, or the MDA chosen on a pending registration
    const sc = recordScope(auth.ctx, "employees.documents.view");
    const rows = await sql`
      SELECT
        du.id as document_id,
        du.registration_id,
        du.appointment_letter_path,
        du.educational_certificates_path,
        du.profile_image_path,
        du.signature_path,
        du.status,
        du.upload_date
      FROM document_uploads du
      LEFT JOIN employees emp ON emp.registration_id = du.registration_id
      LEFT JOIN employment_info ei ON ei.registration_id = du.registration_id
      WHERE (${sc.all}::boolean OR COALESCE(emp.company_id, ei.company_id) = ANY(${sc.companyIds}::int[]) OR COALESCE(emp.department_id, ei.department_id) = ANY(${sc.departmentIds}::int[]))
      ORDER BY du.upload_date DESC NULLS LAST
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
