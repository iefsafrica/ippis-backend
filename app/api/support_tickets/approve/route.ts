import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { ticket_ids?: string[] }
    const ticketIds = body.ticket_ids

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of ticket_ids is required",
      }, 400)
    }

    const existing = await sql`
      SELECT ticket_id FROM support_tickets
      WHERE ticket_id = ANY(${ticketIds})
      AND subject IS NOT NULL AND subject != ''
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
