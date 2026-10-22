import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * What still points at an MDA (companies row) or a department. Deleting either
 * would cascade through the database and silently remove these records,
 * including people's role assignments, so the delete routes refuse while any
 * remain and suggest deactivating instead.
 */

export type Reference = { label: string; count: number };

type Check = { label: string; count: () => Promise<any[]> };

// A table or column that does not exist on this database counts as no references
async function tally(checks: Check[]): Promise<Reference[]> {
  const found: Reference[] = [];
  for (const check of checks) {
    try {
      const rows = await check.count();
      const count = Number(rows[0]?.n ?? 0);
      if (count > 0) found.push({ label: check.label, count });
    } catch (error: any) {
      if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    }
  }
  return found;
}

export function referencesToMda(companyId: number, companyCode: string | null) {
  const code = companyCode ?? "";
  return tally([
    { label: "departments", count: () => sql`SELECT COUNT(*)::int AS n FROM departments WHERE company_id = ${companyId}` },
    { label: "designations", count: () => sql`SELECT COUNT(*)::int AS n FROM designations WHERE company_code = ${code}` },
    { label: "locations", count: () => sql`SELECT COUNT(*)::int AS n FROM locations WHERE company_code = ${code}` },
    { label: "company policies", count: () => sql`SELECT COUNT(*)::int AS n FROM company_policies WHERE company_code = ${code}` },
    { label: "announcements", count: () => sql`SELECT COUNT(*)::int AS n FROM announcements WHERE company_code = ${code}` },
    { label: "user accounts", count: () => sql`SELECT COUNT(*)::int AS n FROM admin_users WHERE mda_id = ${companyId}` },
    { label: "role assignments", count: () => sql`SELECT COUNT(*)::int AS n FROM user_roles WHERE company_id = ${companyId}` },
    { label: "direct permission grants", count: () => sql`SELECT COUNT(*)::int AS n FROM user_permissions WHERE company_id = ${companyId}` },
  ]);
}

export function referencesToDepartment(departmentId: number) {
  return tally([
    { label: "user accounts", count: () => sql`SELECT COUNT(*)::int AS n FROM admin_users WHERE department_id = ${departmentId}` },
    { label: "role assignments", count: () => sql`SELECT COUNT(*)::int AS n FROM user_roles WHERE department_id = ${departmentId}` },
    { label: "direct permission grants", count: () => sql`SELECT COUNT(*)::int AS n FROM user_permissions WHERE department_id = ${departmentId}` },
    { label: "performance appraisers", count: () => sql`SELECT COUNT(*)::int AS n FROM performance_appraisers WHERE department_id = ${departmentId}` },
    { label: "performance indicators", count: () => sql`SELECT COUNT(*)::int AS n FROM performance_indicators WHERE department_id = ${departmentId}` },
  ]);
}

export function describe(references: Reference[]) {
  return references.map((r) => `${r.count} ${r.label}`).join(", ");
}
