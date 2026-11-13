import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited } from "@/lib/rbac";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const money = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.prepare");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    let period = typeof body.period === "string" ? body.period.trim() : "";
    const month = typeof body.month === "string" ? body.month.trim() : "";
    const year = typeof body.year === "string" || typeof body.year === "number" ? String(body.year).trim() : "";

    if (!period && year && month) {
      const padMonth = month.length === 1 ? `0${month}` : month;
      period = `${year}-${padMonth}`;
    }

    if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return withCors(req, { success: false, error: "Valid period (YYYY-MM) or month and year are required" }, 400);
    }

    const [y, m] = period.split("-").map(Number);
    const defaultPaymentDate = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    const paymentDate = typeof body.paymentDate === "string" && body.paymentDate
      ? body.paymentDate
      : typeof body.payment_date === "string" && body.payment_date
      ? body.payment_date
      : defaultPaymentDate;

    const rawMda = body.mdaId ?? body.mda_id ?? body.companyId ?? body.company_id;
    const mdaFilter = rawMda !== undefined && rawMda !== null && rawMda !== "" ? Number(rawMda) : null;
    const rawDept = body.departmentId ?? body.department_id;
    const deptFilter = rawDept !== undefined && rawDept !== null && rawDept !== "" ? Number(rawDept) : null;
    const employeeIdFilter = (body.employeeId ?? body.employee_id ? String(body.employeeId ?? body.employee_id).trim() : null);
    const dryRun = body.dryRun === true || body.dry_run === true;

    const sc = recordScope(auth.ctx, "payroll.cycles.prepare");

    if (employeeIdFilter && !(await employeeInScope(auth.ctx, "payroll.cycles.prepare", employeeIdFilter))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    // 1. Fetch eligible active employees inside scope
    const employees = await sql`
      SELECT 
        e.id, 
        e.name, 
        e.registration_id, 
        e.company_id, 
        e.department_id,
        c.name AS mda_name,
        d.name AS department_name
      FROM employees e
      LEFT JOIN companies c ON c.id = e.company_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE LOWER(COALESCE(e.status, '')) = 'active'
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
        AND (${mdaFilter}::int IS NULL OR e.company_id = ${mdaFilter})
        AND (${deptFilter}::int IS NULL OR e.department_id = ${deptFilter})
        AND (${employeeIdFilter}::text IS NULL OR e.id = ${employeeIdFilter})
      ORDER BY e.name
    `;

    if (employees.length === 0) {
      return withCors(req, { success: false, error: "No active employees found matching the specified filters" }, 404);
    }

    const staffIds = employees.map((e: any) => String(e.id));
    const regIds = employees.map((e: any) => String(e.registration_id || ""));

    // 2. Check who is already paid/generated for this period
    const existingPayments = await sql`
      SELECT employee_id 
      FROM payroll 
      WHERE employee_id = ANY(${staffIds}::text[]) 
        AND LOWER(COALESCE(payment_type, 'salary')) = 'salary'
        AND to_char(payment_date, 'YYYY-MM') = ${period}
    `;
    const alreadyPaidIds = new Set(existingPayments.map((p: any) => String(p.employee_id)));

    // 3. Fetch latest salary structure for each employee on or before payment date
    const salaryRows = await sql`
      SELECT DISTINCT ON (ep.employee_id)
        ep.employee_id::text AS employee_id,
        ep.basic_salary,
        ep.house_rent_allowance,
        ep.medical_allowance,
        ep.travel_allowance,
        ep.dearness_allowance,
        ep.provident_fund,
        ep.income_tax,
        ep.health_insurance,
        ep.loan_deduction
      FROM employee_payments ep
      WHERE (ep.employee_id::text = ANY(${staffIds}::text[]) OR ep.employee_id::text = ANY(${regIds}::text[]))
        AND (ep.payment_date IS NULL OR ep.payment_date::date <= ${paymentDate}::date)
      ORDER BY ep.employee_id, ep.payment_date DESC NULLS LAST, ep.created_at DESC NULLS LAST
    `;

    const salaryMap = new Map<string, any>();
    for (const row of salaryRows) {
      salaryMap.set(String(row.employee_id), row);
    }

    const included: Array<{
      employeeId: string;
      name: string;
      mdaId: number | null;
      departmentId: number | null;
      basic: number;
      gross: number;
      deductions: number;
      net: number;
    }> = [];

    const skipped: Array<{ employeeId: string; name: string; reason: string }> = [];

    for (const emp of employees) {
      const empId = String(emp.id);
      const regId = String(emp.registration_id || "");

      if (alreadyPaidIds.has(empId)) {
        skipped.push({ employeeId: empId, name: emp.name, reason: "Already has a payslip/salary for this period" });
        continue;
      }

      const sal = salaryMap.get(empId) || salaryMap.get(regId);
      if (!sal) {
        skipped.push({ employeeId: empId, name: emp.name, reason: "No active salary structure found on or before payment date" });
        continue;
      }

      const basic = money(sal.basic_salary);
      const allowances = money(sal.house_rent_allowance) + money(sal.medical_allowance) + money(sal.travel_allowance) + money(sal.dearness_allowance);
      const deductions = money(sal.provident_fund) + money(sal.income_tax) + money(sal.health_insurance) + money(sal.loan_deduction);
      const gross = money(basic + allowances);
      const net = money(gross - deductions);

      if (net <= 0) {
        skipped.push({ employeeId: empId, name: emp.name, reason: "Computed net pay is zero or negative" });
        continue;
      }

      included.push({
        employeeId: empId,
        name: emp.name,
        mdaId: emp.company_id ? Number(emp.company_id) : null,
        departmentId: emp.department_id ? Number(emp.department_id) : null,
        basic,
        gross,
        deductions,
        net,
      });
    }

    const totalGross = money(included.reduce((sum, item) => sum + item.gross, 0));
    const totalDeductions = money(included.reduce((sum, item) => sum + item.deductions, 0));
    const totalNetPay = money(included.reduce((sum, item) => sum + item.net, 0));

    if (dryRun) {
      return withCors(req, {
        success: true,
        data: {
          dryRun: true,
          period,
          paymentDate,
          generatedCount: included.length,
          totalGross,
          totalDeductions,
          totalNetPay,
          eligible: included.map((i) => ({ employeeId: i.employeeId, name: i.name, gross: i.gross, net: i.net })),
          skipped,
        },
      });
    }

    if (included.length === 0) {
      return withCors(
        req,
        {
          success: false,
          error: "No payslips could be generated for the specified criteria",
          skipped,
        },
        409
      );
    }

    // 4. Batch insert into payroll table
    const targetMda = mdaFilter || included[0]?.mdaId || null;
    let runId: number | null = null;

    if (targetMda) {
      const [run] = await sql`
        INSERT INTO payroll_runs (company_id, period, payment_date, employee_count, total_amount, skipped, prepared_by, status)
        VALUES (
          ${targetMda},
          ${period},
          ${paymentDate},
          ${included.length},
          ${totalNetPay},
          ${JSON.stringify(skipped)}::jsonb,
          ${auth.ctx.user.username},
          'pending'
        )
        RETURNING id
      `;
      runId = run?.id ? Number(run.id) : null;
    }

    const rowsJson = JSON.stringify(
      included.map((item) => ({
        payment_id: `PS-${period.replace("-", "")}-${item.employeeId}`,
        employee_id: item.employeeId,
        payment_date: paymentDate,
        payment_type: "salary",
        amount: item.net,
        status: "pending",
        payroll_run_id: runId,
      }))
    );

    await sql`
      INSERT INTO payroll (payment_id, employee_id, payment_date, payment_type, amount, status, payroll_run_id, created_at, updated_at)
      SELECT x.payment_id, x.employee_id, x.payment_date::date, x.payment_type, x.amount, x.status, x.payroll_run_id, NOW(), NOW()
      FROM jsonb_to_recordset(${rowsJson}::jsonb) AS x(
        payment_id text,
        employee_id text,
        payment_date text,
        payment_type text,
        amount numeric,
        status text,
        payroll_run_id int
      )
    `;

    await runAudited(
      req,
      auth.ctx,
      {
        action: "payroll.payslips.generated",
        targetType: "payroll",
        details: { period, count: included.length, totalNetPay, skipped: skipped.length },
      },
      []
    );

    return withCors(
      req,
      {
        success: true,
        message: `Payslips successfully generated for ${included.length} employee(s)`,
        data: {
          runId,
          period,
          paymentDate,
          generatedCount: included.length,
          totalGross,
          totalDeductions,
          totalNetPay,
          status: "Generated",
          skipped,
        },
      },
      201
    );
  } catch (error: any) {
    console.error("GENERATE PAYSLIPS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to generate payslips", details: error?.message }, 500);
  }
}

