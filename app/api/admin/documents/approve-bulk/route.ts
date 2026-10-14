import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.verify");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as { registrationIds?: string[] };
    const { registrationIds } = body;

    if (!Array.isArray(registrationIds) || registrationIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of registrationIds is required"
      }, 400);
    }

    // Update the document status to 'approved' for all provided IDs
    const updated = await sql`
      UPDATE document_uploads
      SET status = 'approved'
      WHERE registration_id = ANY(${registrationIds}::text[])
      RETURNING registration_id, status
    `;

    if (updated.length === 0) {
      return withCors(req, {
        success: false,
        error: "No documents found for the provided registration IDs."
      }, 404);
    }

    await runAudited(req, auth.ctx, {
      action: "employees.documents.bulk_approved",
      targetType: "registration",
      targetId: null,
      details: { count: updated.length },
    }, []);

    return withCors(req, {
      success: true,
      message: `Documents for ${updated.length} employees approved successfully`,
      data: updated
    });
  } catch (error) {
    console.error("Error approving documents in bulk:", error);
    return withCors(req, {
      success: false,
      error: "Failed to approve documents in bulk",
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}
