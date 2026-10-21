import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Payslips for the employee portal. A payroll row becomes visible to the
 * employee once payroll has approved or paid it. The salary breakdown comes
 * from employee_payments: the latest structure dated on or before the payment.
 */

export const RELEASED_STATUSES = ["approved", "paid", "processed", "completed", "disbursed"];

const EARNINGS: [string, string][] = [
  ["basic_salary", "Basic salary"],
  ["house_rent_allowance", "Housing allowance"],
  ["medical_allowance", "Medical allowance"],
  ["travel_allowance", "Transport allowance"],
  ["dearness_allowance", "Cost of living allowance"],
];
const DEDUCTIONS: [string, string, string][] = [
  ["provident_fund", "Pension contribution", "pension"],
  ["income_tax", "Income tax (PAYE)", "tax"],
  ["health_insurance", "Health insurance", "other"],
  ["loan_deduction", "Loan repayment", "other"],
];

const money = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);

export type Payslip = {
  paymentId: string;
  paymentDate: string | null;
  type: string | null;
  status: string;
  amountPaid: number;
  earnings: { item: string; amount: number }[];
  deductions: { item: string; amount: number; kind: string }[];
  gross: number;
  totalDeductions: number;
  computedNet: number;
  tax: number;
  pension: number;
  breakdownAvailable: boolean;
};

export async function payslipsFor(employeeId: string, opts: { paymentId?: string | undefined; year?: number | undefined } = {}): Promise<Payslip[]> {
  const rows = await sql`
    SELECT p.payment_id, p.payment_date::date::text AS payment_date, p.payment_type, LOWER(COALESCE(p.status, '')) AS status, p.amount,
           s.basic_salary, s.house_rent_allowance, s.medical_allowance, s.travel_allowance, s.dearness_allowance,
           s.provident_fund, s.income_tax, s.health_insurance, s.loan_deduction, (s.id IS NOT NULL) AS has_breakdown
    FROM payroll p
    LEFT JOIN employees e ON e.id::text = p.employee_id::text
    LEFT JOIN LATERAL (
      -- employee_payments.employee_id is a UUID column; compare as text against
      -- both the staff id and the registration id, whichever it holds
      SELECT * FROM employee_payments ep
      WHERE ep.employee_id::text IN (p.employee_id::text, COALESCE(e.registration_id::text, ''))
        AND (ep.payment_date IS NULL OR p.payment_date IS NULL OR ep.payment_date::date <= p.payment_date::date)
      ORDER BY ep.payment_date DESC NULLS LAST
      LIMIT 1
    ) s ON TRUE
    WHERE p.employee_id::text = ${employeeId}
      AND LOWER(COALESCE(p.status, '')) = ANY(${RELEASED_STATUSES})
      AND (${opts.paymentId ?? null}::text IS NULL OR p.payment_id = ${opts.paymentId ?? null})
      AND (${opts.year ?? null}::int IS NULL OR EXTRACT(YEAR FROM p.payment_date::date) = ${opts.year ?? null})
    ORDER BY p.payment_date DESC NULLS LAST
  `;

  return rows.map((r: any) => {
    const earnings = EARNINGS.map(([col, item]) => ({ item, amount: money(r[col]) })).filter((e) => e.amount !== 0);
    const deductions = DEDUCTIONS.map(([col, item, kind]) => ({ item, amount: money(r[col]), kind })).filter((d) => d.amount !== 0);
    const gross = money(earnings.reduce((s, e) => s + e.amount, 0));
    const totalDeductions = money(deductions.reduce((s, d) => s + d.amount, 0));
    return {
      paymentId: String(r.payment_id),
      paymentDate: r.payment_date ?? null,
      type: r.payment_type ?? null,
      status: String(r.status),
      amountPaid: money(r.amount),
      earnings,
      deductions,
      gross,
      totalDeductions,
      computedNet: money(gross - totalDeductions),
      tax: money(deductions.filter((d) => d.kind === "tax").reduce((s, d) => s + d.amount, 0)),
      pension: money(deductions.filter((d) => d.kind === "pension").reduce((s, d) => s + d.amount, 0)),
      breakdownAvailable: Boolean(r.has_breakdown),
    };
  });
}

/** Payroll rows for the employee that are not released yet, so the portal can say "in progress". */
export async function payrollInProgress(employeeId: string) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM payroll
    WHERE employee_id::text = ${employeeId} AND NOT (LOWER(COALESCE(status, '')) = ANY(${RELEASED_STATUSES}))
  `;
  return rows[0]?.n ?? 0;
}
