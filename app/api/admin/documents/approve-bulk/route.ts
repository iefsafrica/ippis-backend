import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
