
// app/api/admin/documents/[id]/approve/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    // Extract the registrationId from the URL path
    const url = new URL(req.url)
    const parts = url.pathname.split("/")
    const registrationId = parts[parts.length - 2] 

    if (!registrationId) {
      return withCors(req, {
        success: false,
        error: "registrationId (from URL) is required"
      }, 400)
    }

    // Update the document status to 'approved'
    const updated = await sql`
      UPDATE document_uploads
      SET status = 'approved'
      WHERE registration_id = ${registrationId}
      RETURNING *
    `

    if (updated.length === 0) {
      return withCors(req, {
        success: false,
        error: "No documents found for this registrationId"
      }, 404)
    }

    return withCors(req, {
      success: true,
      message: `Documents for employee ${registrationId} approved successfully`,
      data: updated[0]
    })
  } catch (error) {
    console.error("Error approving documents:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve documents",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}
