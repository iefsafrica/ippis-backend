import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason, type AuthContext } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";
import { notifyMany } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

/**
 * Payroll runs: one MDA's payroll for a month, prepared and approved as a
 * whole. Preparing a run creates a pending payroll record for every active
 * employee of the MDA with a salary structure (net pay from the latest
 * structure dated on or before the payment date), and lists those skipped:
 * no salary structure, or already paid a salary that month. Approving needs
 * payroll approval rights over the MDA and someone other than the preparer;
 * it releases every record of the run to the employees. Rejecting (with a
 * note) removes the run's records so it can be prepared again.
 */

const VIEW = "payroll.cycles.view";
const PREPARE = "payroll.cycles.prepare";
const APPROVE = "payroll.cycles.approve";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/** Runs are MDA-wide, so they need the permission over the whole MDA. */
function coversMda(ctx: AuthContext, key: string, companyId: number) {
  const sc = recordScope(ctx, key);
  return sc.all || sc.companyIds.includes(companyId);
}

const lastDayOf = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};

// GET              runs of the MDAs the caller covers   ?company_id= ?period=
// GET ?id=         one run with its payroll records
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const sc = recordScope(auth.ctx, VIEW);

    if (id) {
      const [run] = await db`SELECT r.*, c.name AS mda_name FROM payroll_runs r JOIN companies c ON c.id = r.company_id WHERE r.id::text = ${id}`;
      if (!run || !coversMda(auth.ctx, VIEW, Number(run.company_id))) {
        return withCors(req, { success: false, error: "Not found or outside your organisational scope" }, 404);
      }
      const records = await db`
        SELECT p.payment_id, p.employee_id, e.name AS employee_name, p.amount, p.status, p.payment_date::date::text AS payment_date
        FROM payroll p LEFT JOIN employees e ON e.id = p.employee_id
        WHERE p.payroll_run_id = ${run.id} ORDER BY e.name
      `;
      return withCors(req, { success: true, data: { ...run, records } });
    }

    const companyId = searchParams.get("company_id");
    const period = searchParams.get("period");
    const runs = await db`
      SELECT r.*, c.name AS mda_name FROM payroll_runs r JOIN companies c ON c.id = r.company_id
      WHERE (${sc.all}::boolean OR r.company_id = ANY(${sc.companyIds}::int[]))
        AND (${companyId}::text IS NULL OR r.company_id::text = ${companyId})
        AND (${period}::text IS NULL OR r.period = ${period})
      ORDER BY r.period DESC, c.name
      LIMIT 300
    `;
    return withCors(req, { success: true, data: runs });
  } catch (error) {
    console.error("LIST PAYROLL RUNS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch payroll runs" }, 500);
  }
}

// Body: { company_id, period: "YYYY-MM", payment_date?: "YYYY-MM-DD" (default: last day of the month), dry_run? }
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, PREPARE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = Number(body.company_id ?? body.mda_id);
    const period = typeof body.period === "string" ? body.period.trim() : "";
    if (!Number.isInteger(companyId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return withCors(req, { success: false, error: "company_id and period (YYYY-MM) are required" }, 400);
    }
    const paymentDate = typeof body.payment_date === "string" && body.payment_date ? body.payment_date : lastDayOf(period);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || !paymentDate.startsWith(period)) {
      return withCors(req, { success: false, error: "payment_date must be a date (YYYY-MM-DD) in that month" }, 400);
    }
    if (!coversMda(auth.ctx, PREPARE, companyId)) {
      return withCors(req, { success: false, error: "Preparing this MDA's payroll needs payroll rights over the whole MDA" }, 403);
    }
    const [mda] = await db`SELECT id, name, status FROM companies WHERE id = ${companyId}`;
    if (!mda || String(mda.status ?? "active").toLowerCase() !== "active") {
      return withCors(req, { success: false, error: "company_id must be an active MDA" }, 400);
    }

    // Every active employee of the MDA, with the latest salary structure on or before the payment date
    const staff = await db`
      SELECT e.id, e.name, s.net,
             EXISTS (
               SELECT 1 FROM payroll p WHERE p.employee_id = e.id AND LOWER(COALESCE(p.payment_type, 'salary')) = 'salary'
                 AND to_char(p.payment_date, 'YYYY-MM') = ${period}
             ) AS already_paid
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT COALESCE(ep.basic_salary, 0) + COALESCE(ep.house_rent_allowance, 0) + COALESCE(ep.medical_allowance, 0)
               + COALESCE(ep.travel_allowance, 0) + COALESCE(ep.dearness_allowance, 0)
               - COALESCE(ep.provident_fund, 0) - COALESCE(ep.income_tax, 0) - COALESCE(ep.health_insurance, 0)
               - COALESCE(ep.loan_deduction, 0) AS net
        FROM employee_payments ep
        WHERE ep.employee_id::text IN (e.id::text, COALESCE(e.registration_id::text, ''))
          AND (ep.payment_date IS NULL OR ep.payment_date::date <= ${paymentDate}::date)
        ORDER BY ep.payment_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      WHERE e.company_id = ${companyId} AND LOWER(COALESCE(e.status, '')) = 'active'
      ORDER BY e.name
    `;
    const included = staff.filter((s: any) => s.net != null && Number(s.net) > 0 && !s.already_paid);
    const skipped = staff
      .filter((s: any) => !included.includes(s))
      .map((s: any) => ({ employee_id: s.id, name: s.name, reason: s.already_paid ? "Already paid a salary this month" : "No salary structure" }));
    const total = Math.round(included.reduce((sum: number, s: any) => sum + Number(s.net), 0) * 100) / 100;

    if (body.dry_run === true) {
      return withCors(req, { success: true, data: { dry_run: true, mda: mda.name, period, employees: included.length, total_amount: total, skipped } });
    }
    if (included.length === 0) {
      return withCors(req, { success: false, error: "No employee of this MDA can be paid for this month", skipped }, 409);
    }

    const rows = JSON.stringify(included.map((s: any) => ({
      payment_id: `PR-${period.replace("-", "")}-${companyId}-${s.id}`,
      employee_id: s.id,
      amount: Math.round(Number(s.net) * 100) / 100,
    })));
    try {
      const [created] = await runAudited(
        req,
        auth.ctx,
        { action: "payroll.run.prepared", targetType: "mda", targetId: companyId, details: { period, employees: included.length, total_amount: total, skipped: skipped.length } },
        [
          db`
            INSERT INTO payroll_runs (company_id, period, payment_date, employee_count, total_amount, skipped, prepared_by)
            VALUES (${companyId}, ${period}, ${paymentDate}, ${included.length}, ${total}, ${JSON.stringify(skipped)}::jsonb, ${auth.ctx.user.username})
            RETURNING *
          `,
          db`
            INSERT INTO payroll (payment_id, employee_id, payment_date, payment_type, amount, status, payroll_run_id, created_at, updated_at)
            SELECT x.payment_id, x.employee_id, ${paymentDate}, 'salary', x.amount, 'pending',
                   currval(pg_get_serial_sequence('payroll_runs', 'id')), NOW(), NOW()
            FROM jsonb_to_recordset(${rows}::jsonb) AS x(payment_id text, employee_id text, amount numeric)
          `,
        ]
      );
      return withCors(req, { success: true, message: `Payroll prepared for ${included.length} employee(s); it now needs approval`, data: { ...(created as any[])[0], skipped } }, 201);
    } catch (error: any) {
      if (error?.code === "23505") return withCors(req, { success: false, error: "This MDA already has a payroll run for that month" }, 409);
      throw error;
    }
  } catch (error) {
    console.error("PREPARE PAYROLL RUN ERROR:", error);
    return withCors(req, { success: false, error: "Failed to prepare the payroll run" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject", note? }  (note required to reject)
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, APPROVE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const note = readReason(body.note);
    if (!Number.isInteger(id) || (body.decision !== "approve" && body.decision !== "reject")) {
      return withCors(req, { success: false, error: "id and decision (approve or reject) are required" }, 400);
    }
    const [run] = await db`SELECT * FROM payroll_runs WHERE id = ${id}`;
    if (!run || !coversMda(auth.ctx, APPROVE, Number(run.company_id))) {
      return withCors(req, { success: false, error: "Not found or outside your organisational scope" }, 404);
    }
    if (run.status !== "prepared") return withCors(req, { success: false, error: `This run is already ${run.status}` }, 409);
    // Separation of duties: whoever prepared the run does not approve it
    if (run.prepared_by === auth.ctx.user.username) {
      return withCors(req, { success: false, error: "You prepared this run, so someone else must decide it" }, 403);
    }

    if (body.decision === "reject") {
      if (!note) return withCors(req, { success: false, error: "A note is required to reject" }, 400);
      await runAudited(req, auth.ctx, { action: "payroll.run.rejected", targetType: "mda", targetId: run.company_id, reason: note, details: { run_id: id, period: run.period } }, [
        db`UPDATE payroll_runs SET status = 'rejected', decided_by = ${auth.ctx.user.username}, decided_at = NOW(), decision_note = ${note} WHERE id = ${id} AND status = 'prepared'`,
        db`DELETE FROM payroll WHERE payroll_run_id = ${id} AND status = 'pending'`,
      ]);
      return withCors(req, { success: true, message: "Payroll run rejected; it can be prepared again" });
    }

    const [, approved] = await runAudited(
      req,
      auth.ctx,
      { action: "payroll.run.approved", targetType: "mda", targetId: run.company_id, reason: note, details: { run_id: id, period: run.period, total_amount: run.total_amount } },
      [
        db`UPDATE payroll_runs SET status = 'approved', decided_by = ${auth.ctx.user.username}, decided_at = NOW(), decision_note = ${note} WHERE id = ${id} AND status = 'prepared'`,
        db`
          UPDATE payroll SET status = 'approved', updated_at = NOW()
          WHERE payroll_run_id = ${id} AND status = 'pending'
          RETURNING payment_id, employee_id, payment_date::date::text AS payment_date
        `,
      ]
    );
    const released = (approved as any[]) ?? [];
    await notifyMany("payroll", released.map((row) => ({
      employeeId: String(row.employee_id),
      title: "Payslip available",
      message: `Your payslip for the payment of ${row.payment_date} is ready to view.`,
      link: `/employee/payslips/${row.payment_id}`,
      dedupeKey: `payslip:${row.payment_id}`,
    })));
    return withCors(req, { success: true, message: `Payroll run approved: ${released.length} payslip(s) released` });
  } catch (error) {
    console.error("DECIDE PAYROLL RUN ERROR:", error);
    return withCors(req, { success: false, error: "Failed to decide the payroll run" }, 500);
  }
}
