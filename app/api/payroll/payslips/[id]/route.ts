import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { recordScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const money = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.view");
    if (!auth.ok) return auth.response;

    const params = await props.params;
    const rawId = decodeURIComponent(params.id || "").trim();
    if (!rawId) {
      return withCors(req, { success: false, error: "Payslip ID is required" }, 400);
    }

    const sc = recordScope(auth.ctx, "payroll.cycles.view");

    // Fetch payroll record matching either numeric id or payment_id string
    const isNumeric = Number.isInteger(Number(rawId));
    const [row] = await sql`
      SELECT 
        p.id AS numeric_id,
        p.payment_id,
        p.employee_id,
        p.payment_date,
        p.payment_type,
        p.amount AS net_amount,
        p.status,
        p.created_at,
        e.registration_id,
        e.name AS employee_name,
        e.department,
        e.position,
        e.join_date,
        c.name AS mda_name,
        d.name AS department_name,
        ei.gl AS grade_level,
        ei.step,
        ei.cadre,
        ei.salary_structure,
        ei.work_location,
        ei.name_of_bank,
        ei.account_number,
        ei.pfa_name,
        ei.rsapin,
        ei.date_of_first_appointment,
        pi.sex AS gender,
        pi.date_of_birth,
        pi.state_of_origin,
        pi.state_of_residence,
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
      LEFT JOIN personal_info pi ON pi.registration_id = e.registration_id
      LEFT JOIN LATERAL (
        SELECT * FROM employee_payments s
        WHERE (s.employee_id = e.id OR s.employee_id = e.registration_id)
          AND (s.payment_date IS NULL OR s.payment_date::date <= p.payment_date::date)
        ORDER BY s.payment_date DESC NULLS LAST, s.created_at DESC NULLS LAST
        LIMIT 1
      ) ep ON TRUE
      WHERE (${isNumeric}::boolean AND p.id = ${isNumeric ? Number(rawId) : 0} OR p.payment_id = ${rawId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      LIMIT 1
    `;

    if (!row) {
      return withCors(req, { success: false, error: "Payslip not found or outside your organizational scope" }, 404);
    }

    const pDate = row.payment_date ? new Date(row.payment_date) : new Date();
    const periodMonth = pDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const pYear = pDate.getFullYear();

    // Itemized Earnings
    const earnings: Array<{ type: string; amount: number }> = [];
    const basic = money(row.basic_salary);
    if (basic > 0) earnings.push({ type: "Basic Salary", amount: basic });
    if (money(row.house_rent_allowance) > 0) earnings.push({ type: "House Rent Allowance", amount: money(row.house_rent_allowance) });
    if (money(row.medical_allowance) > 0) earnings.push({ type: "Medical Allowance", amount: money(row.medical_allowance) });
    if (money(row.travel_allowance) > 0) earnings.push({ type: "Travel & Transport Allowance", amount: money(row.travel_allowance) });
    if (money(row.dearness_allowance) > 0) earnings.push({ type: "Dearness & Cost of Living Allowance", amount: money(row.dearness_allowance) });

    if (earnings.length === 0) {
      earnings.push({ type: "Consolidated Public Service Salary", amount: money(row.net_amount) });
    }

    // Itemized Deductions
    const deductions: Array<{ type: string; amount: number; category: string }> = [];
    if (money(row.income_tax) > 0) deductions.push({ type: "Income Tax (PAYE)", amount: money(row.income_tax), category: "tax" });
    if (money(row.provident_fund) > 0) deductions.push({ type: "Contributory Pension (8%)", amount: money(row.provident_fund), category: "pension" });
    if (money(row.health_insurance) > 0) deductions.push({ type: "National Health Insurance (NHIS)", amount: money(row.health_insurance), category: "health" });
    if (money(row.loan_deduction) > 0) deductions.push({ type: "Staff Cooperative Loan Deduction", amount: money(row.loan_deduction), category: "loan" });

    const totalEarnings = money(earnings.reduce((s, e) => s + e.amount, 0));
    const totalDeductions = money(deductions.reduce((s, d) => s + d.amount, 0));
    const netPay = money(row.net_amount);

    // Calculate Year-to-date aggregates for this employee
    const [ytd] = await sql`
      SELECT 
        COALESCE(SUM(p.amount), 0) AS total_paid,
        COALESCE(SUM(ep.income_tax), 0) AS total_tax,
        COALESCE(SUM(ep.provident_fund), 0) AS total_pension
      FROM payroll p
      LEFT JOIN LATERAL (
        SELECT provident_fund, income_tax FROM employee_payments s
        WHERE (s.employee_id = p.employee_id)
        ORDER BY s.payment_date DESC NULLS LAST LIMIT 1
      ) ep ON TRUE
      WHERE p.employee_id = ${row.employee_id}
        AND EXTRACT(YEAR FROM p.payment_date::date) = ${pYear}
        AND LOWER(COALESCE(p.status, '')) IN ('approved', 'paid', 'generated', 'completed', 'disbursed')
    `;

    return withCors(req, {
      success: true,
      data: {
        id: String(row.payment_id),
        numericId: Number(row.numeric_id),
        paymentDate: pDate.toISOString().split("T")[0],
        payPeriod: `${periodMonth} 1 - ${periodMonth} ${new Date(pDate.getFullYear(), pDate.getMonth() + 1, 0).getDate()}`,
        month: periodMonth,
        status: String(row.status || "Approved"),
        generatedAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),

        employee: {
          id: String(row.employee_id),
          legacyId: row.registration_id ? `REG-${row.registration_id}` : `IPPIS-${row.employee_id}`,
          name: row.employee_name || "Civil Service Officer",
          gender: row.gender ? String(row.gender).toUpperCase() : "MALE",
          dob: row.date_of_birth ? new Date(row.date_of_birth).toISOString().split("T")[0] : null,
          appointmentDate: row.date_of_first_appointment || row.join_date ? new Date(row.date_of_first_appointment || row.join_date).toISOString().split("T")[0] : null,
          mda: row.mda_name || "Federal Public Service",
          department: row.department_name || row.department || "General Administration",
          position: row.position || "Civil Officer",
          cadre: row.cadre || `${row.position || "Civil Officer"} Cadre`,
          grade: row.grade_level ? `GL ${row.grade_level}` : "GL 10",
          step: String(row.step || "1"),
          salaryStructure: row.salary_structure || "CONPSS",
          location: row.work_location || "Federal Secretariat, Abuja",
          taxState: row.state_of_residence || row.state_of_origin || "FCT",
        },

        disbursement: {
          bankName: row.name_of_bank || "Central Bank / Commercial Bank",
          accountNumber: row.account_number || "XXXXXXXXXX",
          paymentMethod: "Direct Electronic Bank Transfer (NIBSS)",
          pfa: row.pfa_name || "PenCom Registered PFA",
          rsaPin: row.rsapin || "N/A",
        },

        earnings,
        deductions,

        summary: {
          basicSalary: basic > 0 ? basic : netPay,
          totalEarnings,
          totalDeductions,
          netPay,
          taxYearToDate: money(ytd?.total_tax),
          pensionYearToDate: money(ytd?.total_pension),
          paidYearToDate: money(ytd?.total_paid),
        },
      },
    });
  } catch (error: any) {
    console.error("GET PAYSLIP DETAILS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch payslip details", details: error?.message }, 500);
  }
}
