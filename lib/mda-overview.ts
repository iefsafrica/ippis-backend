import { neon } from "@neondatabase/serverless";
import { can, type AuthContext } from "@/lib/rbac";
import { recordScope, type RecordScope } from "@/lib/mda-scope";
import { todayLagos } from "@/lib/employee-time";

const sql = neon(process.env.DATABASE_URL!);

/**
 * The per-MDA overview (DSH-01, DSH-02): what is happening in one MDA, for
 * whoever is responsible for it. Each section needs the permission that
 * already governs its records, and every number is limited to the caller's
 * scope for that permission, so a department head sees their department's
 * share of the MDA and a payroll officer sees payroll but not leave.
 *
 * A section whose tables are missing on this database is reported as
 * unavailable rather than failing the whole overview.
 */

export const SECTIONS = {
  workforce: "employees.records.view",
  onboarding: "employees.registrations.view",
  requests: "employees.records.view",
  documents: "employees.documents.view",
  attendance: "timesheets.attendance.view",
  leave: "timesheets.leaves.view",
  payroll: "payroll.cycles.view",
  movements: "corehr.records.view",
  access: "users.accounts.view",
} as const;
export type Section = keyof typeof SECTIONS;

/** Whether the caller holds the permission with any reach into the MDA. */
export function reaches(ctx: AuthContext, key: string, companyId: number, departmentsOfMda: number[]) {
  if (!can(ctx, key)) return false;
  const sc = recordScope(ctx, key);
  return sc.all || sc.companyIds.includes(companyId) || sc.departmentIds.some((d) => departmentsOfMda.includes(d));
}

const n = (v: unknown) => Number(v ?? 0);

async function workforce(mda: number, sc: RecordScope) {
  const [totals] = await sql`
    SELECT COUNT(*) FILTER (WHERE LOWER(e.status) = 'active') AS active,
           COUNT(*) FILTER (WHERE LOWER(e.status) NOT IN ('active', 'deleted')) AS inactive,
           COUNT(*) FILTER (WHERE LOWER(e.status) = 'active' AND e.department_id IS NULL) AS without_department,
           COUNT(*) FILTER (WHERE LOWER(e.status) = 'active' AND e.designation_id IS NULL) AS without_designation,
           COUNT(*) FILTER (WHERE LOWER(e.status) = 'active' AND e.created_at >= date_trunc('month', NOW())) AS joined_this_month
    FROM employees e
    WHERE e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  const byDepartment = await sql`
    SELECT d.id, d.name, COUNT(e.id) FILTER (WHERE LOWER(e.status) = 'active') AS active
    FROM departments d
    LEFT JOIN employees e ON e.department_id = d.id AND e.company_id = ${mda}
    WHERE d.company_id = ${mda}
      AND (${sc.all}::boolean OR d.company_id = ANY(${sc.companyIds}::int[]) OR d.id = ANY(${sc.departmentIds}::int[]))
    GROUP BY d.id, d.name
    ORDER BY active DESC, d.name
  `;
  return {
    active: n(totals?.active),
    inactive: n(totals?.inactive),
    joined_this_month: n(totals?.joined_this_month),
    by_department: byDepartment.map((d: any) => ({ id: Number(d.id), name: d.name, active: n(d.active) })),
    data_quality: { without_department: n(totals?.without_department), without_designation: n(totals?.without_designation) },
  };
}

async function onboarding(mda: number, sc: RecordScope) {
  const [row] = await sql`
    SELECT COUNT(*) AS pending_registrations,
           COUNT(*) FILTER (WHERE p.created_at < NOW() - INTERVAL '14 days') AS waiting_over_14_days
    FROM pending_employees p
    JOIN employment_info ei ON ei.registration_id = p.registration_id
    WHERE ei.company_id = ${mda}
      AND (${sc.all}::boolean OR ei.company_id = ANY(${sc.companyIds}::int[]) OR ei.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  return { pending_registrations: n(row?.pending_registrations), waiting_over_14_days: n(row?.waiting_over_14_days) };
}

async function requests(mda: number, sc: RecordScope) {
  const [row] = await sql`
    SELECT COUNT(*) AS profile_changes_pending
    FROM employee_profile_change_requests r JOIN employees e ON e.id = r.employee_id
    WHERE r.status = 'pending' AND e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  return { profile_changes_pending: n(row?.profile_changes_pending) };
}

async function documents(mda: number, sc: RecordScope) {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM employee_documents d JOIN employees e ON e.id = d.employee_id
        WHERE d.status = 'pending' AND d.source = 'employee' AND e.company_id = ${mda}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS uploads_to_verify,
      (SELECT COUNT(*) FROM document_requests r JOIN employees e ON e.id = r.employee_id
        WHERE r.status IN ('open', 'submitted') AND e.company_id = ${mda}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS requests_open,
      (SELECT COUNT(*) FROM document_requests r JOIN employees e ON e.id = r.employee_id
        WHERE r.status = 'open' AND r.due_date < CURRENT_DATE AND e.company_id = ${mda}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS requests_overdue
  `;
  return { uploads_to_verify: n(row?.uploads_to_verify), requests_open: n(row?.requests_open), requests_overdue: n(row?.requests_overdue) };
}

async function attendance(mda: number, sc: RecordScope) {
  const today = todayLagos();
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE LOWER(e.status) = 'active') AS expected,
      COUNT(a.id) FILTER (WHERE LOWER(a.status) = 'present') AS present,
      COUNT(a.id) FILTER (WHERE LOWER(a.status) = 'late') AS late,
      COUNT(a.id) FILTER (WHERE LOWER(a.status) = 'absent') AS absent,
      COUNT(*) FILTER (WHERE LOWER(e.status) = 'active' AND a.id IS NULL) AS not_recorded
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT id, status FROM attendance WHERE employee_code = e.id AND attendance_date::text = ${today} ORDER BY id DESC LIMIT 1
    ) a ON TRUE
    WHERE e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  const [queues] = await sql`
    SELECT
      (SELECT COUNT(*) FROM employee_timesheets t JOIN employees e ON e.id = t.employee_id
        WHERE t.status = 'submitted' AND e.company_id = ${mda}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS timesheets_to_review,
      (SELECT COUNT(*) FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id
        WHERE c.status = 'pending' AND e.company_id = ${mda}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS corrections_to_review
  `;
  return {
    date: today,
    expected: n(row?.expected),
    present: n(row?.present),
    late: n(row?.late),
    absent: n(row?.absent),
    not_recorded: n(row?.not_recorded),
    timesheets_to_review: n(queues?.timesheets_to_review),
    corrections_to_review: n(queues?.corrections_to_review),
  };
}

async function leave(mda: number, sc: RecordScope) {
  const today = todayLagos();
  const [row] = await sql`
    SELECT COUNT(*) FILTER (WHERE LOWER(l.status) = 'pending') AS requests_pending,
           COUNT(*) FILTER (WHERE LOWER(l.status) = 'approved' AND ${today}::date BETWEEN l.from_date AND l.to_date) AS on_leave_today
    FROM leaves l JOIN employees e ON e.id = l.employee_code
    WHERE e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  return { requests_pending: n(row?.requests_pending), on_leave_today: n(row?.on_leave_today) };
}

async function payroll(mda: number, sc: RecordScope) {
  const [row] = await sql`
    SELECT COUNT(*) AS records_this_month,
           COALESCE(SUM(p.amount), 0) AS amount_this_month,
           COUNT(*) FILTER (WHERE LOWER(p.status) = 'pending') AS awaiting_approval,
           COALESCE(SUM(p.amount) FILTER (WHERE LOWER(p.status) = 'pending'), 0) AS amount_awaiting_approval
    FROM payroll p JOIN employees e ON e.id = p.employee_id
    WHERE p.payment_date >= date_trunc('month', NOW()) AND p.payment_date < date_trunc('month', NOW()) + INTERVAL '1 month'
      AND e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  const [disputes] = await sql`
    SELECT COUNT(*) AS open FROM payroll_discrepancies d JOIN employees e ON e.id = d.employee_id
    WHERE d.status IN ('open', 'in_review') AND e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  return {
    month: todayLagos().slice(0, 7),
    records: n(row?.records_this_month),
    amount: n(row?.amount_this_month),
    awaiting_approval: n(row?.awaiting_approval),
    amount_awaiting_approval: n(row?.amount_awaiting_approval),
    discrepancies_open: n(disputes?.open),
  };
}

async function movements(mda: number, sc: RecordScope) {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE t.status IN ('pending', 'approved') AND e.company_id = ${mda}
                         AND t.to_company_id IS DISTINCT FROM ${mda}
                         AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))) AS transfers_out,
      COUNT(*) FILTER (WHERE t.status IN ('pending', 'approved') AND t.to_company_id = ${mda}
                         AND e.company_id IS DISTINCT FROM ${mda}
                         AND (${sc.all}::boolean OR t.to_company_id = ANY(${sc.companyIds}::int[]) OR t.to_department_id = ANY(${sc.departmentIds}::int[]))) AS transfers_in,
      COUNT(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= date_trunc('month', NOW())
                         AND (t.to_company_id = ${mda} OR t.from_company_id = ${mda})
                         AND (${sc.all}::boolean OR t.to_company_id = ANY(${sc.companyIds}::int[]) OR t.from_company_id = ANY(${sc.companyIds}::int[])
                              OR t.to_department_id = ANY(${sc.departmentIds}::int[]) OR t.from_department_id = ANY(${sc.departmentIds}::int[]))) AS completed_this_month
    FROM employee_transfers t JOIN employees e ON e.id = t.employee_id
  `;
  const [exits] = await sql`
    SELECT COUNT(*) AS resignations_pending FROM employee_resignations r JOIN employees e ON e.id = r.employee_id
    WHERE r.status = 'pending' AND e.company_id = ${mda}
      AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  return {
    transfers_out: n(row?.transfers_out),
    transfers_in: n(row?.transfers_in),
    transfers_completed_this_month: n(row?.completed_this_month),
    resignations_pending: n(exits?.resignations_pending),
  };
}

async function access(mda: number, sc: RecordScope) {
  // Accounts and grants of this MDA, or of the caller's departments in it
  const [accounts] = await sql`
    SELECT COUNT(*) FILTER (WHERE u.is_active IS NOT FALSE AND COALESCE(u.status, 'active') = 'active') AS active,
           COUNT(*) FILTER (WHERE u.is_active IS FALSE OR COALESCE(u.status, 'active') <> 'active') AS inactive,
           COUNT(*) FILTER (WHERE u.last_login IS NULL OR u.last_login < NOW() - INTERVAL '90 days') AS not_signed_in_90_days
    FROM admin_users u
    WHERE u.mda_id = ${mda}
      AND (${sc.all}::boolean OR u.mda_id = ANY(${sc.companyIds}::int[]) OR u.department_id = ANY(${sc.departmentIds}::int[]))
  `;
  const roles = await sql`
    SELECT r.key, r.name, COUNT(*) AS assignments,
           COUNT(*) FILTER (WHERE ur.expires_at IS NOT NULL AND ur.expires_at < NOW() + INTERVAL '30 days') AS expiring_in_30_days
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.company_id = ${mda} AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND (${sc.all}::boolean OR ur.company_id = ANY(${sc.companyIds}::int[]) OR ur.department_id = ANY(${sc.departmentIds}::int[]))
    GROUP BY r.key, r.name
    ORDER BY assignments DESC
  `;
  return {
    accounts_active: n(accounts?.active),
    accounts_inactive: n(accounts?.inactive),
    accounts_not_signed_in_90_days: n(accounts?.not_signed_in_90_days),
    role_assignments: roles.map((r: any) => ({ role: r.key, name: r.name, assignments: n(r.assignments), expiring_in_30_days: n(r.expiring_in_30_days) })),
  };
}

const BUILDERS: Record<Section, (mda: number, sc: RecordScope) => Promise<unknown>> = {
  workforce, onboarding, requests, documents, attendance, leave, payroll, movements, access,
};

/** The sections of one MDA's overview the caller may see. */
export async function buildOverview(ctx: AuthContext, mda: number, departmentsOfMda: number[]) {
  const out: Partial<Record<Section, unknown>> = {};
  await Promise.all(
    (Object.keys(SECTIONS) as Section[]).map(async (section) => {
      const key = SECTIONS[section];
      if (!reaches(ctx, key, mda, departmentsOfMda)) return;
      try {
        out[section] = await BUILDERS[section](mda, recordScope(ctx, key));
      } catch (error: any) {
        // A table or column this database does not have yet
        if (error?.code === "42P01" || error?.code === "42703") out[section] = { unavailable: true };
        else throw error;
      }
    })
  );
  return out;
}

/**
 * Headline numbers for every MDA the caller reaches, in one pass per measure.
 * Each measure needs its own permission and is limited to the caller's scope.
 */
export async function buildSummary(ctx: AuthContext, mdaIds: number[]) {
  const rows = new Map<number, Record<string, number>>(mdaIds.map((id) => [id, {}]));
  const put = (list: any[], field: string) => {
    for (const r of list) {
      const target = rows.get(Number(r.company_id));
      if (target) target[field] = n(r.n);
    }
  };
  const safely = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error: any) {
      if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    }
  };

  if (can(ctx, SECTIONS.workforce)) {
    const sc = recordScope(ctx, SECTIONS.workforce);
    await safely(async () => put(await sql`
      SELECT e.company_id, COUNT(*) AS n FROM employees e
      WHERE e.company_id = ANY(${mdaIds}::int[]) AND LOWER(e.status) = 'active'
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      GROUP BY e.company_id
    `, "active_employees"));
  }
  if (can(ctx, SECTIONS.onboarding)) {
    const sc = recordScope(ctx, SECTIONS.onboarding);
    await safely(async () => put(await sql`
      SELECT ei.company_id, COUNT(*) AS n FROM pending_employees p JOIN employment_info ei ON ei.registration_id = p.registration_id
      WHERE ei.company_id = ANY(${mdaIds}::int[])
        AND (${sc.all}::boolean OR ei.company_id = ANY(${sc.companyIds}::int[]) OR ei.department_id = ANY(${sc.departmentIds}::int[]))
      GROUP BY ei.company_id
    `, "pending_registrations"));
  }
  if (can(ctx, SECTIONS.leave)) {
    const sc = recordScope(ctx, SECTIONS.leave);
    await safely(async () => put(await sql`
      SELECT e.company_id, COUNT(*) AS n FROM leaves l JOIN employees e ON e.id = l.employee_code
      WHERE e.company_id = ANY(${mdaIds}::int[]) AND LOWER(l.status) = 'pending'
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      GROUP BY e.company_id
    `, "leave_requests_pending"));
  }
  if (can(ctx, SECTIONS.payroll)) {
    const sc = recordScope(ctx, SECTIONS.payroll);
    await safely(async () => put(await sql`
      SELECT e.company_id, COUNT(*) AS n FROM payroll p JOIN employees e ON e.id = p.employee_id
      WHERE e.company_id = ANY(${mdaIds}::int[]) AND LOWER(p.status) = 'pending'
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      GROUP BY e.company_id
    `, "payroll_awaiting_approval"));
  }
  if (can(ctx, SECTIONS.movements)) {
    const sc = recordScope(ctx, SECTIONS.movements);
    await safely(async () => put(await sql`
      SELECT e.company_id, COUNT(*) AS n FROM employee_transfers t JOIN employees e ON e.id = t.employee_id
      WHERE e.company_id = ANY(${mdaIds}::int[]) AND t.status IN ('pending', 'approved')
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      GROUP BY e.company_id
    `, "transfers_out_open"));
  }
  return rows;
}

/** Employees no MDA has claimed yet: only someone with rights across all MDAs sees them (ORG-08). */
export async function unlinkedEmployees(ctx: AuthContext) {
  if (!can(ctx, SECTIONS.workforce) || !recordScope(ctx, SECTIONS.workforce).all) return null;
  const [row] = await sql`SELECT COUNT(*) AS n FROM employees WHERE company_id IS NULL AND LOWER(status) NOT IN ('deleted')`;
  return n(row?.n);
}
