import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { moduleScope } from "@/lib/module-scope"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "support.tickets.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { ticket_ids?: string[] }
    const ticketIds = body.ticket_ids

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of ticket_ids is required",
      }, 400)
    }

    // Only tickets of the caller's MDA or department; the rest are skipped
    const sc = moduleScope(auth.ctx, "support.tickets.approve")
    const existing = await sql`
      SELECT s.ticket_id FROM support_tickets s
      WHERE s.ticket_id = ANY(${ticketIds})
      AND s.subject IS NOT NULL AND s.subject != ''
      AND (${sc.all}::boolean OR s.company_id = ANY(${sc.companyIds}::int[]) OR s.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND s.company_id IS NULL))
    `
    const existingIds = existing.map(r => r.ticket_id)
    const missingIds = ticketIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid tickets found to approve.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE support_tickets
      SET status = 'Approved', updated_at = NOW()
      WHERE ticket_id = ANY(${existingIds})
      RETURNING ticket_id
    `

    await runAudited(req, auth.ctx, { action: "support.ticket.approved", targetType: "support.ticket", details: {} }, [])

    return withCors(req, {
      success: true,
      message: `${results.length} tickets approved successfully`,
      approvedTicketIds: results.map(r => r.ticket_id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving tickets:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve tickets",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
