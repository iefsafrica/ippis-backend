import { neon } from "@neondatabase/serverless";
import { scopeOf, type AuthContext } from "@/lib/rbac";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Record-level MDA scoping (ORG-02, ORG-07, ORG-08, DSH-02).
 *
 * A personnel record belongs to the MDA and department of its employee
 * (employees.company_id / department_id). A user sees and changes only
 * records inside the scope of the permission the route needs:
 *   - global grant: everything, including employees not yet linked to an MDA
 *   - MDA grant: employees of that MDA
 *   - department grant: employees of that department
 * Employees without an MDA are visible to global grants only.
 *
 * In SQL, filter a query that joins employees as `e` with:
 *
 *   const sc = recordScope(auth.ctx, "employees.records.view");
 *   ... WHERE (${sc.all}::boolean
 *              OR e.company_id = ANY(${sc.companyIds}::int[])
 *              OR e.department_id = ANY(${sc.departmentIds}::int[]))
 */

export type RecordScope = { all: boolean; companyIds: number[]; departmentIds: number[] };

export function recordScope(ctx: AuthContext, key: string): RecordScope {
  const s = scopeOf(ctx, key);
  return { all: s.global, companyIds: s.companyIds, departmentIds: s.departmentIds };
}

/** Whether a record of this MDA and department falls inside the scope. */
export function inScope(sc: RecordScope, companyId: unknown, departmentId: unknown) {
  if (sc.all) return true;
  if (companyId != null && sc.companyIds.includes(Number(companyId))) return true;
  if (departmentId != null && sc.departmentIds.includes(Number(departmentId))) return true;
  return false;
}

/** The ids, of those given, that the caller may NOT reach (missing employees count as unreachable). */
export async function employeesOutOfScope(ctx: AuthContext, key: string, employeeIds: string[]): Promise<string[]> {
  const ids = [...new Set(employeeIds.map(String))];
  if (ids.length === 0) return [];
  const sc = recordScope(ctx, key);
  const rows = await sql`SELECT id::text AS id, company_id, department_id FROM employees WHERE id::text = ANY(${ids})`;
  const reachable = new Set(rows.filter((r: any) => inScope(sc, r.company_id, r.department_id)).map((r: any) => String(r.id)));
  return ids.filter((id) => !reachable.has(id));
}

export async function employeeInScope(ctx: AuthContext, key: string, employeeId: unknown): Promise<boolean> {
  if (employeeId === undefined || employeeId === null || employeeId === "") return false;
  return (await employeesOutOfScope(ctx, key, [String(employeeId)])).length === 0;
}

/**
 * Keeps the rows whose employee (the `column` holding employees.id) is inside
 * the scope. For short, unpaginated lists; paginated lists filter in SQL so
 * their totals stay right.
 */
export async function keepInScope<T extends Record<string, any>>(ctx: AuthContext, key: string, rows: T[], column = "employee_id"): Promise<T[]> {
  if (recordScope(ctx, key).all) return rows;
  const ids = rows.map((r) => r[column]).filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const out = new Set(await employeesOutOfScope(ctx, key, ids));
  return rows.filter((r) => r[column] !== null && r[column] !== undefined && r[column] !== "" && !out.has(String(r[column])));
}

/** Whether the department exists and is inside the scope (its MDA or the department itself). */
export async function departmentInScope(ctx: AuthContext, key: string, departmentId: unknown): Promise<boolean> {
  const id = Number(departmentId);
  if (!Number.isInteger(id)) return false;
  const [d] = await sql`SELECT id, company_id FROM departments WHERE id = ${id}`;
  return !!d && inScope(recordScope(ctx, key), d.company_id, d.id);
}

/**
 * A registration belongs to the MDA its applicant became an employee of, or,
 * while pending, the MDA chosen on the registration form. Registrations with
 * neither are reachable with global rights only.
 */
export async function registrationsOutOfScope(ctx: AuthContext, key: string, registrationIds: string[]): Promise<string[]> {
  const ids = [...new Set(registrationIds.map(String))];
  if (ids.length === 0) return [];
  const sc = recordScope(ctx, key);
  if (sc.all) return [];
  const rows = await sql`
    SELECT r.id,
           COALESCE(e.company_id, ei.company_id) AS company_id,
           COALESCE(e.department_id, ei.department_id) AS department_id
    FROM unnest(${ids}::text[]) AS r(id)
    LEFT JOIN employees e ON e.registration_id = r.id
    LEFT JOIN employment_info ei ON ei.registration_id = r.id
  `;
  const reachable = new Set(rows.filter((r: any) => inScope(sc, r.company_id, r.department_id)).map((r: any) => String(r.id)));
  return ids.filter((id) => !reachable.has(id));
}

export async function registrationInScope(ctx: AuthContext, key: string, registrationId: unknown): Promise<boolean> {
  if (registrationId === undefined || registrationId === null || registrationId === "") return false;
  return (await registrationsOutOfScope(ctx, key, [String(registrationId)])).length === 0;
}

/** The answer for a record outside the caller's scope: the same as a record that does not exist. */
export const OUT_OF_SCOPE = "Not found or outside your organisational scope";
