import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * What still points at an MDA (companies row) or a department. Deleting either
 * would cascade through the database and silently remove these records,
 * including people's role assignments, so the delete routes refuse while any
 * remain and suggest deactivating instead.
 */

export type Reference = { label: string; count: number };

type Check = { label: string; count: () => Promise<any[] | undefined> };

// A table or column that does not exist on this database counts as no references
async function tally(checks: Check[]): Promise<Reference[]> {
  const found: Reference[] = [];
  for (const check of checks) {
    try {
      const rows = await check.count();
      const count = Number(rows?.[0]?.n ?? 0);
      if (count > 0) found.push({ label: check.label, count });
    } catch (error: any) {
      if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    }
  }
  return found;
}

// Records linked by MDA id or code. Before organisation-links-migration.sql
// runs these tables have no company_id, so the code alone is counted.
function byIdOrCode(table: "designations" | "locations" | "company_policies" | "announcements", companyId: number, code: string) {
  return async () => {
    try {
      switch (table) {
        case "designations": return await sql`SELECT COUNT(*)::int AS n FROM designations WHERE company_id = ${companyId} OR TRIM(company_code) = ${code}`;
        case "locations": return await sql`SELECT COUNT(*)::int AS n FROM locations WHERE company_id = ${companyId} OR TRIM(company_code) = ${code}`;
        case "company_policies": return await sql`SELECT COUNT(*)::int AS n FROM company_policies WHERE company_id = ${companyId} OR TRIM(company_code) = ${code}`;
        case "announcements": return await sql`SELECT COUNT(*)::int AS n FROM announcements WHERE company_id = ${companyId} OR TRIM(company_code) = ${code}`;
      }
    } catch (error: any) {
      if (error?.code !== "42703") throw error;
      switch (table) {
        case "designations": return await sql`SELECT COUNT(*)::int AS n FROM designations WHERE TRIM(company_code) = ${code}`;
        case "locations": return await sql`SELECT COUNT(*)::int AS n FROM locations WHERE TRIM(company_code) = ${code}`;
        case "company_policies": return await sql`SELECT COUNT(*)::int AS n FROM company_policies WHERE TRIM(company_code) = ${code}`;
        case "announcements": return await sql`SELECT COUNT(*)::int AS n FROM announcements WHERE TRIM(company_code) = ${code}`;
      }
    }
  };
}

export function referencesToMda(companyId: number, companyCode: string | null) {
  const code = (companyCode ?? "").trim();
  return tally([
    { label: "departments", count: () => sql`SELECT COUNT(*)::int AS n FROM departments WHERE company_id = ${companyId}` },
    { label: "designations", count: byIdOrCode("designations", companyId, code) },
    { label: "locations", count: byIdOrCode("locations", companyId, code) },
    { label: "company policies", count: byIdOrCode("company_policies", companyId, code) },
    { label: "announcements", count: byIdOrCode("announcements", companyId, code) },
    { label: "employees", count: () => sql`SELECT COUNT(*)::int AS n FROM employees WHERE company_id = ${companyId}` },
    { label: "employee transfers", count: () => sql`SELECT COUNT(*)::int AS n FROM employee_transfers WHERE to_company_id = ${companyId} OR from_company_id = ${companyId}` },
    { label: "user accounts", count: () => sql`SELECT COUNT(*)::int AS n FROM admin_users WHERE mda_id = ${companyId}` },
    { label: "role assignments", count: () => sql`SELECT COUNT(*)::int AS n FROM user_roles WHERE company_id = ${companyId}` },
    { label: "direct permission grants", count: () => sql`SELECT COUNT(*)::int AS n FROM user_permissions WHERE company_id = ${companyId}` },
  ]);
}

export function referencesToDepartment(departmentId: number) {
  return tally([
    { label: "employees", count: () => sql`SELECT COUNT(*)::int AS n FROM employees WHERE department_id = ${departmentId}` },
    { label: "employee transfers", count: () => sql`SELECT COUNT(*)::int AS n FROM employee_transfers WHERE to_department_id = ${departmentId} OR from_department_id = ${departmentId}` },
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
