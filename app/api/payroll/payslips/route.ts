import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";
import { POST as generateHandler } from "./generate/route";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const money = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const sc = recordScope(auth.ctx, "payroll.cycles.view");

    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "10")));
    const offset = (page - 1) * limit;

    const periodParam = searchParams.get("period");
    const monthParam = searchParams.get("month");
    const yearParam = searchParams.get("year");
    let periodFilter: string | null = null;

    if (periodParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodParam)) {
      periodFilter = periodParam;
    } else if (yearParam && monthParam) {
      const padM = monthParam.length === 1 ? `0${monthParam}` : monthParam;
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(`${yearParam}-${padM}`)) {
        periodFilter = `${yearParam}-${padM}`;
      }
    }

    const deptParam = searchParams.get("department_id") || searchParams.get("departmentId");
    const deptFilter = deptParam && Number.isInteger(Number(deptParam)) ? Number(deptParam) : null;

    const mdaParam = searchParams.get("mda_id") || searchParams.get("company_id") || searchParams.get("companyId");
    const mdaFilter = mdaParam && Number.isInteger(Number(mdaParam)) ? Number(mdaParam) : null;

    const employeeId = searchParams.get("employee_id") || searchParams.get("employeeId");
    const statusParam = searchParams.get("status")?.toLowerCase();

    // Query payslips with joined employee & salary structure figures
    const rows = await sql`
      SELECT 
        p.id AS numeric_id,
        p.payment_id,
        p.employee_id,
        p.payment_date,
        p.payment_type,
        p.amount AS net_amount,
        p.status,
        p.created_at,
        e.name AS employee_name,
        e.department,
        e.position,
        e.company_id,
        e.department_id,
        c.name AS mda_name,
        d.name AS department_name,
        ei.gl AS grade_level,
        ei.step,
        ei.cadre,
        ep.basic_salary,
        ep.house_rent_allowance,
        ep.medical_allowance,
        ep.travel_allowance,
        ep.dearness_allowance,
        ep.provident_fund,
        ep.income_tax,
        ep.health_insurance,
        ep.loan_deduction
      FROM payroll p
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN companies c ON c.id = e.company_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employment_info ei ON ei.registration_id = e.registration_id
      LEFT JOIN LATERAL (
        SELECT * FROM employee_payments s
        WHERE s.employee_id::text IN (e.id::text, COALESCE(e.registration_id::text, ''))
          AND (s.payment_date IS NULL OR s.payment_date::date <= p.payment_date::date)
        ORDER BY s.payment_date DESC NULLS LAST, s.created_at DESC NULLS LAST
        LIMIT 1
      ) ep ON TRUE
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
        AND (${mdaFilter}::int IS NULL OR e.company_id = ${mdaFilter})
        AND (${deptFilter}::int IS NULL OR e.department_id = ${deptFilter})
        AND (${employeeId}::text IS NULL OR e.id = ${employeeId})
        AND (${periodFilter}::text IS NULL OR to_char(p.payment_date, 'YYYY-MM') = ${periodFilter})
        AND (${statusParam}::text IS NULL OR LOWER(p.status) = ${statusParam})
      ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM payroll p
      JOIN employees e ON e.id = p.employee_id
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
        AND (${mdaFilter}::int IS NULL OR e.company_id = ${mdaFilter})
        AND (${deptFilter}::int IS NULL OR e.department_id = ${deptFilter})
        AND (${employeeId}::text IS NULL OR e.id = ${employeeId})
        AND (${periodFilter}::text IS NULL OR to_char(p.payment_date, 'YYYY-MM') = ${periodFilter})
        AND (${statusParam}::text IS NULL OR LOWER(p.status) = ${statusParam})
    `;
    const total = Number(countResult?.[0]?.total || 0);

    const payslips = rows.map((r: any) => {
      const basic = money(r.basic_salary);
      const allowances = money(r.house_rent_allowance) + money(r.medical_allowance) + money(r.travel_allowance) + money(r.dearness_allowance);
      const deductions = money(r.provident_fund) + money(r.income_tax) + money(r.health_insurance) + money(r.loan_deduction);
      const gross = basic + allowances > 0 ? money(basic + allowances) : money(r.net_amount);
      const totalDeductions = deductions > 0 ? deductions : money(gross - Number(r.net_amount));
      const pDate = r.payment_date ? new Date(r.payment_date) : new Date();

      return {
        id: String(r.payment_id),
        numericId: Number(r.numeric_id),
        employeeId: String(r.employee_id),
        employeeName: r.employee_name || "Civil Service Officer",
        department: r.department_name || r.department || "General Public Service",
        position: r.position || "Officer",
        grade: r.grade_level ? `GL ${r.grade_level}` : "GL 10",
        step: String(r.step || "1"),
        month: pDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        period: pDate.toISOString().slice(0, 7),
        paymentDate: pDate.toISOString().split("T")[0],
        generatedDate: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        grossPay: gross,
        totalDeductions,
        netPay: money(r.net_amount),
        status: String(r.status || "Generated"),
      };
    });

    return withCors(req, {
      success: true,
      data: {
        payslips,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error: any) {
    console.error("LIST PAYSLIPS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to list payslips", details: error?.message }, 500);
  }
}

// Forward POST requests directly to generateHandler
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.cycles.prepare");
  if (!auth.ok) return auth.response;
  return generateHandler(req);
}
