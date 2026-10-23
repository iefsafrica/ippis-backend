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
    const auth = await requirePermission(req, "finance.records.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { expense_ids?: string[] }
    const expenseIds = body.expense_ids

    if (!expenseIds || !Array.isArray(expenseIds) || expenseIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of expense_ids is required",
      }, 400)
    }

    // Only expenses of accounts in the caller's MDA or department; the rest are skipped
    const sc = moduleScope(auth.ctx, "finance.records.approve")
    const existing = await sql`
      SELECT e.expense_id FROM finance_expenses e
      JOIN finance_accounts a ON a.account_id = e.account_id
      WHERE e.expense_id = ANY(${expenseIds})
      AND e.amount > 0
      AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
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

    await runAudited(req, auth.ctx, { action: "finance.expense.approved", targetType: "finance.expense", details: { approved: results.map(r => r.expense_id) } }, [])

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
