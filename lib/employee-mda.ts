import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Matching employees' free-text ministry and department (from registration)
 * to the official MDA list. Matching is exact after tidying the text; it never
 * guesses between two possible MDAs, and anything it cannot match is left for
 * HR to map.
 */

export function normaliseName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9()\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** The ways a name can be written: as is, without a bracketed part, and the bracketed part alone ("... (OHCSF)"). */
function variants(value: unknown): string[] {
  const full = normaliseName(value);
  if (!full) return [];
  const out = new Set([full.replace(/[()]/g, "").replace(/\s+/g, " ").trim()]);
  const withoutBrackets = full.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
  if (withoutBrackets) out.add(withoutBrackets);
  for (const m of full.matchAll(/\(([^)]+)\)/g)) {
    const inner = m[1]!.trim();
    if (inner) out.add(inner);
  }
  return [...out];
}

export type MdaEntry = { id: number; name: string; company_code: string | null; status: string | null };
export type DepartmentEntry = { id: number; company_id: number; name: string };

export type Directory = {
  mdas: MdaEntry[];
  departments: DepartmentEntry[];
  byKey: Map<string, Set<number>>;
};

export async function loadDirectory(): Promise<Directory> {
  const [mdas, departments] = await Promise.all([
    sql`SELECT id, name, company_code, status FROM companies`,
    sql`SELECT id, company_id, name FROM departments`,
  ]);
  const byKey = new Map<string, Set<number>>();
  const add = (key: string, id: number) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(id);
  };
  for (const m of mdas) {
    for (const v of variants(m.name)) add(v, Number(m.id));
    if (m.company_code) add(normaliseName(m.company_code), Number(m.id));
  }
  return {
    mdas: mdas.map((m: any) => ({ id: Number(m.id), name: String(m.name), company_code: m.company_code ?? null, status: m.status ?? null })),
    departments: departments.map((d: any) => ({ id: Number(d.id), company_id: Number(d.company_id), name: String(d.name) })),
    byKey,
  };
}

/** The one MDA the text names, "ambiguous" when it could be more than one, or null. */
export function matchMda(dir: Directory, text: unknown): MdaEntry | "ambiguous" | null {
  const ids = new Set<number>();
  for (const v of variants(text)) for (const id of dir.byKey.get(v) ?? []) ids.add(id);
  if (ids.size === 0) return null;
  if (ids.size > 1) return "ambiguous";
  const id = [...ids][0]!;
  return dir.mdas.find((m) => m.id === id) ?? null;
}

export function matchDepartment(dir: Directory, companyId: number, text: unknown): DepartmentEntry | null {
  const wanted = normaliseName(text);
  if (!wanted) return null;
  const found = dir.departments.filter((d) => d.company_id === companyId && normaliseName(d.name) === wanted);
  return found.length === 1 ? found[0]! : null;
}

export type EmployeeOrgRow = {
  id: string;
  name: string;
  status: string;
  company_id: number | null;
  department_id: number | null;
  organization: string | null;
  department_text: string | null;
  form_company_id: number | null;
  form_department_id: number | null;
};

/** Every employee with their current link and the free text from registration. */
export async function loadEmployeeOrgRows(employeeIds?: string[]): Promise<EmployeeOrgRow[]> {
  const rows = await sql`
    SELECT e.id, e.name, e.status, e.company_id, e.department_id,
           NULLIF(TRIM(ei.organization), '') AS organization,
           COALESCE(NULLIF(TRIM(ei.department), ''), NULLIF(TRIM(e.department), '')) AS department_text,
           ei.company_id AS form_company_id, ei.department_id AS form_department_id
    FROM employees e
    LEFT JOIN employment_info ei ON ei.registration_id = e.registration_id
    WHERE (${employeeIds ?? null}::text[] IS NULL OR e.id = ANY(${employeeIds ?? null}::text[]))
    ORDER BY e.name
  `;
  return rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status ?? ""),
    company_id: r.company_id == null ? null : Number(r.company_id),
    department_id: r.department_id == null ? null : Number(r.department_id),
    organization: r.organization ?? null,
    department_text: r.department_text ?? null,
    form_company_id: r.form_company_id == null ? null : Number(r.form_company_id),
    form_department_id: r.form_department_id == null ? null : Number(r.form_department_id),
  }));
}

export type Suggestion =
  | { status: "linked"; companyId: number; departmentId: number | null }
  | { status: "matched"; source: "registration form" | "ministry name"; companyId: number; departmentId: number | null }
  | { status: "ambiguous" | "unmatched" | "missing"; reason: string };

/** What the employee is, or could be, linked to. */
export function suggest(dir: Directory, row: EmployeeOrgRow): Suggestion {
  if (row.company_id != null) {
    return { status: "linked", companyId: row.company_id, departmentId: row.department_id };
  }
  if (row.form_company_id != null) {
    return { status: "matched", source: "registration form", companyId: row.form_company_id, departmentId: row.form_department_id };
  }
  if (!row.organization) {
    return { status: "missing", reason: "No ministry recorded at registration" };
  }
  const mda = matchMda(dir, row.organization);
  if (mda === "ambiguous") {
    return { status: "ambiguous", reason: `'${row.organization}' could be more than one MDA` };
  }
  if (!mda) {
    return { status: "unmatched", reason: `'${row.organization}' does not match any MDA` };
  }
  const dept = matchDepartment(dir, mda.id, row.department_text);
  return { status: "matched", source: "ministry name", companyId: mda.id, departmentId: dept?.id ?? null };
}

/**
 * Links an employee who has no MDA yet, when their registration names one
 * exactly. Used after approval; never throws and never changes an existing link.
 */
export async function linkEmployeeToMda(employeeId: string, linkedBy: string) {
  try {
    const [row] = await loadEmployeeOrgRows([employeeId]);
    if (!row || row.company_id != null) return { linked: false as const };
    const found = suggest(await loadDirectory(), row);
    if (found.status !== "matched") return { linked: false as const, reason: "reason" in found ? found.reason : found.status };
    const updated = await sql`
      UPDATE employees
      SET company_id = ${found.companyId}, department_id = ${found.departmentId},
          mda_linked_at = NOW(), mda_linked_by = ${linkedBy}
      WHERE id = ${employeeId} AND company_id IS NULL
      RETURNING id
    `;
    return { linked: updated.length > 0, companyId: found.companyId, departmentId: found.departmentId };
  } catch (error) {
    console.error(`EMPLOYEE MDA LINK ${employeeId}:`, error);
    return { linked: false as const, reason: "error" };
  }
}
