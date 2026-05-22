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
    const body = (await req.json()) as { expense_ids?: string[] }
    const expenseIds = body.expense_ids

    if (!expenseIds || !Array.isArray(expenseIds) || expenseIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of expense_ids is required",
      }, 400)
    }

    const existing = await sql`
      SELECT expense_id FROM finance_expenses
      WHERE expense_id = ANY(${expenseIds})
      AND amount > 0 AND account_id IS NOT NULL
    `
    const existingIds = existing.map(r => r.expense_id)
    const missingIds = expenseIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid expenses found to approve. Expenses must have an amount and account ID.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE finance_expenses
      SET status = 'Approved', updated_at = NOW()
      WHERE expense_id = ANY(${existingIds})
      RETURNING expense_id
    `

    return withCors(req, {
      success: true,
      message: `${results.length} expenses approved successfully`,
      approvedExpenseIds: results.map(r => r.expense_id),
      skippedIds: missingIds
    })

  } catch (error) {
    console.error("Error approving expenses:", error)
    return withCors(req, {
      success: false,
      error: "Failed to approve expenses",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
