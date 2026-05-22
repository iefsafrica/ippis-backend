import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
const sql = neon(process.env.DATABASE_URL!)

// Handle preflight request
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest)
}

// GET /api/admin/documents/stats
export async function GET(req: Request) {
  try {
    // Count documents by status
    const result = await sql`
      SELECT 
        status,
        COUNT(*) AS total
      FROM document_uploads
      WHERE status IN ('verified', 'approved')
      GROUP BY status
    `

    // Calculate totals
    const verifiedCount =
      result.find((r) => r.status === "verified")?.total ?? 0
    const approvedCount =
      result.find((r) => r.status === "approved")?.total ?? 0
    const total = verifiedCount + approvedCount

    return withCors(req as unknown as NextRequest, {
      success: true,
      data: {
        verified: Number(verifiedCount),
        approved: Number(approvedCount),
        total: Number(total),
      },
    })
  } catch (error) {
    console.error("Error fetching document stats:", error)
    return withCors(
      req as unknown as NextRequest,
      {
        success: false,
        error: "Failed to fetch document stats.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}
