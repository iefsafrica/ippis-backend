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
    const body = (await req.json()) as { payment_ids?: string[] }
    const paymentIds = body.payment_ids

    if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of payment_ids is required",
      }, 400)
    }

    // Check if payroll records exist and have required data
    const existing = await sql`
      SELECT payment_id FROM payroll
      WHERE payment_id = ANY(${paymentIds})
      AND amount > 0 AND employee_id IS NOT NULL
    `
    const existingIds = existing.map(r => r.payment_id)
    const missingIds = paymentIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid payroll records found to approve. Records must exist and have an amount and employee ID.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE payroll
      SET status = 'approved', updated_at = NOW()
      WHERE payment_id = ANY(${existingIds})
      RETURNING payment_id
    `

    return withCors(req, {
      success: true,
      message: `${results.length} payroll records approved successfully`,
      approvedIds: results.map(r => r.payment_id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving payroll:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve payroll",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
