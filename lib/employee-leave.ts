import { neon } from "@neondatabase/serverless";
import { eachDate, isoWeekday, dateText } from "@/lib/employee-time";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Leave balances. Leave counts working days only: weekends and public
 * holidays inside a request are not deducted.
 */

export type LeaveType = { id: number; code: string; name: string; days_per_year: number; is_active: boolean };

export async function leaveTypes(activeOnly = true): Promise<LeaveType[]> {
  const rows = await sql`
    SELECT id, code, name, days_per_year, is_active
    FROM leave_types
    WHERE (${activeOnly} = FALSE OR is_active)
    ORDER BY name
  `;
  return rows as LeaveType[];
}

/** Public holiday dates (YYYY-MM-DD) between two dates. */
export async function holidayDates(from: string, to: string): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const rows = await sql`
      SELECT start_date::date::text AS start_date, COALESCE(end_date, start_date)::date::text AS end_date
      FROM holidays
      WHERE LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'cancelled', 'disabled')
        AND start_date::date <= ${to}::date
        AND COALESCE(end_date, start_date)::date >= ${from}::date
    `;
    for (const h of rows) for (const d of eachDate(String(h.start_date), String(h.end_date))) set.add(d);
  } catch (error) {
    console.error("HOLIDAYS:", error);
  }
  return set;
}

export function workingDays(from: string, to: string, holidays: Set<string>): number {
  return eachDate(from, to).filter((d) => isoWeekday(d) <= 5 && !holidays.has(d)).length;
}

/** Matches a leave row's free-text leave_type against a configured type. */
export function matchesType(rowType: unknown, type: { code: string; name: string }) {
  const value = String(rowType ?? "").trim().toLowerCase();
  return value === type.code || value === type.name.toLowerCase() || value === type.code.replace(/_/g, " ");
}

export type Balance = {
  code: string;
  name: string;
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
  available: number;
};

/** Entitlement, used (approved), pending and remaining days per active type for one year. */
export async function leaveBalances(employeeId: string, year: number): Promise<Balance[]> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [types, overrides, requests, holidays] = await Promise.all([
    leaveTypes(true),
    sql`SELECT leave_type_id, days FROM leave_entitlements WHERE employee_id = ${employeeId} AND year = ${year}`,
    sql`
      SELECT leave_type, LOWER(status) AS status, from_date::date::text AS from_date, to_date::date::text AS to_date
      FROM leaves
      WHERE employee_code = ${employeeId}
        AND LOWER(status) IN ('approved', 'pending')
        AND from_date::date <= ${to}::date AND to_date::date >= ${from}::date
    `,
    holidayDates(from, to),
  ]);
  const override = new Map(overrides.map((o: any) => [Number(o.leave_type_id), Number(o.days)]));

  return types.map((type) => {
    let used = 0;
    let pending = 0;
    for (const r of requests) {
      if (!matchesType(r.leave_type, type)) continue;
      // Only the part of a request that falls inside this year counts against it
      const start = String(dateText(r.from_date)) < from ? from : String(dateText(r.from_date));
      const end = String(dateText(r.to_date)) > to ? to : String(dateText(r.to_date));
      const days = workingDays(start, end, holidays);
      if (r.status === "approved") used += days;
      else pending += days;
    }
    const entitlement = override.get(type.id) ?? type.days_per_year;
    const remaining = entitlement - used;
    return { code: type.code, name: type.name, entitlement, used, pending, remaining, available: remaining - pending };
  });
}
