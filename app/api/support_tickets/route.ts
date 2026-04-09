import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../lib/cors"
import { NextRequest } from "next/server"
import crypto from "crypto"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// Support Ticket type
type SupportTicket = {
  id?: number
  ticket_id: string
  subject: string
  description: string
  department: string
  priority: string
  status?: string
  assigned_to?: string
  attachment?: string
  created_at?: string
  updated_at?: string
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// POST: Create new ticket
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject: string
      description: string
      department: string
      priority: string
      assigned_to?: string
      attachment?: string
    }

    const { subject, description, department, priority, assigned_to, attachment } = body

    if (!subject || !description || !department || !priority) {
      return withCors(req, {
        success: false,
        error: "Subject, description, department, and priority are required",
      }, 400)
    }

    // Generate ticket_id like TICKET-XXXX
    const randomId = crypto.randomBytes(3).toString("hex").toUpperCase()
    const ticketId = `TICKET-${randomId}`

    const result = await sql`
      INSERT INTO support_tickets (
        ticket_id,
        subject,
        description,
        department,
        priority,
        assigned_to,
        attachment,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${ticketId},
        ${subject},
        ${description},
        ${department},
        ${priority},
        ${assigned_to ?? null},
        ${attachment ?? null},
        'Open',
        NOW(),
        NOW()
      )
      RETURNING *
    ` as SupportTicket[]

    return withCors(req, {
      success: true,
      message: "Support ticket created successfully",
      ticket: result[0]
    })

  } catch (error) {
    console.error(" Error creating support ticket:", error)
    return withCors(req, {
      success: false,
      error: "Failed to create support ticket",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}

// GET: List tickets with optional query params
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get("page") || "1")
    const limit = Number(searchParams.get("limit") || "10")
    const offset = (page - 1) * limit

    const tickets = await sql`
      SELECT * FROM support_tickets
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as SupportTicket[]

    const countResult = await sql`
      SELECT COUNT(*) AS total FROM support_tickets
    ` as { total: number }[]

    const total = Number(countResult[0]?.total ?? 0)

    return withCors(req, {
      success: true,
      data: {
        tickets,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        }
      }
    })

  } catch (error) {
    console.error(" Error fetching support tickets:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch support tickets",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}

// PATCH: Update ticket (status, assigned_to, priority)
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      ticket_id: string
      status?: string
      assigned_to?: string
      priority?: string
    }

    const { ticket_id, status, assigned_to, priority } = body

    if (!ticket_id) {
      return withCors(req, { success: false, error: "ticket_id is required" }, 400)
    }

    const updated = await sql`
      UPDATE support_tickets
      SET
        status = COALESCE(${status}, status),
        assigned_to = COALESCE(${assigned_to}, assigned_to),
        priority = COALESCE(${priority}, priority),
        updated_at = NOW()
      WHERE ticket_id = ${ticket_id}
      RETURNING *
    ` as SupportTicket[]

    if (!updated || updated.length === 0) {
      return withCors(req, { success: false, error: "Ticket not found" }, 404)
    }

    return withCors(req, {
      success: true,
      message: "Ticket updated successfully",
      ticket: updated[0]
    })

  } catch (error) {
    console.error("Error updating ticket:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update ticket",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}

// DELETE: Remove ticket
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ticketId = searchParams.get("ticket_id")

    if (!ticketId) {
      return withCors(req, { success: false, error: "ticket_id is required" }, 400)
    }

    await sql`
      DELETE FROM support_tickets
      WHERE ticket_id = ${ticketId}
    `

    return withCors(req, {
      success: true,
      message: "Ticket deleted successfully",
      ticketId
    })

  } catch (error) {
    console.error(" Error deleting ticket:", error)
    return withCors(req, {
      success: false,
      error: "Failed to delete ticket",
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
}