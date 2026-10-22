import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { notifyMany } from "@/lib/employee-notifications"
import { recordScope } from "@/lib/mda-scope"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.approve")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as { payment_ids?: string[] }
    const paymentIds = body.payment_ids

    if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "An array of payment_ids is required",
      }, 400)
    }

    // Check if payroll records exist, have required data and belong to
    // employees inside the caller's MDA or department; the rest are skipped
    const sc = recordScope(auth.ctx, "payroll.cycles.approve")
    const existing = await sql`
      SELECT p.payment_id FROM payroll p
      JOIN employees e ON e.id = p.employee_id
      WHERE p.payment_id = ANY(${paymentIds})
      AND p.amount > 0
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
    `
    const existingIds = existing.map(r => r.payment_id)
    const missingIds = paymentIds.filter(id => !existingIds.includes(id))

    if (existingIds.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid payroll records found to approve. Records must exist, have an amount and belong to an employee inside your organisational scope.",
        missingIds
      }, 404)
    }

    const results = await sql`
      UPDATE payroll
      SET status = 'approved', updated_at = NOW()
      WHERE payment_id = ANY(${existingIds})
      RETURNING payment_id, employee_id, payment_date::date::text AS payment_date
    `

    await runAudited(req, auth.ctx, { action: "payroll.cycle.approved", targetType: "payroll.cycle", details: { approved: results.map(r => r.payment_id) } }, [])

    // Each employee hears that their payslip is ready
    await notifyMany("payroll", (results as any[]).map((row) => ({
      employeeId: String(row.employee_id),
      title: "Payslip available",
      message: `Your payslip for the payment of ${row.payment_date} is ready to view.`,
      link: `/employee/payslips/${row.payment_id}`,
      dedupeKey: `payslip:${row.payment_id}`,
    })))

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
