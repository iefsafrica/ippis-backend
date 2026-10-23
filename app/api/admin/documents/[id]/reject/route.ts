// app/api/admin/documents/[id]/reject/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { registrationInScope, OUT_OF_SCOPE } from "@/lib/mda-scope"

export const dynamic = "force-dynamic"
const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.verify")
    if (!auth.ok) return auth.response

    // ✅ Extract registrationId from URL path
    const url = new URL(req.url)
    const parts = url.pathname.split("/")
    const registrationId = parts[parts.length - 2] // since "reject" is the last part

    // ✅ Parse request body safely
    const body = (await req.json().catch(() => ({}))) as { reason?: string }
    const reason = body.reason || "No reason provided"

    if (!registrationId) {
      return withCors(
        req,
        { success: false, error: "registrationId (from URL) is required" },
        400
      )
    }

    if (!(await registrationInScope(auth.ctx, "employees.documents.verify", registrationId))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)
    }

    // ✅ Update document status to 'rejected'
    const updated = await sql`
      UPDATE document_uploads
      SET status = 'rejected'
      WHERE registration_id = ${registrationId}
      RETURNING *
    `

    if (updated.length === 0) {
      return withCors(
        req,
        { success: false, error: "No documents found for this registrationId" },
        404
      )
    }

    await runAudited(req, auth.ctx, {
      action: "employees.documents.rejected",
      targetType: "registration",
      targetId: registrationId,
      reason: typeof reason === "string" ? reason : null,
      details: {},
    }, [])

    return withCors(req, {
      success: true,
      message: `Documents for employee ${registrationId} rejected successfully`,
      data: { ...updated[0], reason },
    })
  } catch (error) {
    console.error("Error rejecting documents:", error)
    return withCors(
      req,
      {
        success: false,
        error: "Failed to reject documents",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}
