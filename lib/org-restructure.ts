import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";
import { runAudited, type AuthContext } from "@/lib/rbac";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Restructuring MDAs: moving a department to another MDA, or merging one MDA
 * into another.
 *
 * Records point at a department together with its MDA (composite keys), so a
 * department cannot simply change MDA in place. Instead:
 *   1. the destination MDA gets a matching department, and matching
 *      designations and locations for the ones in use (found by name, or
 *      created) — harmless on its own, and reused if the move is retried;
 *   2. in one transaction, everything that pointed at the old units is moved
 *      to the new ones: employees, registrations, the shared modules' records,
 *      open transfers, performance records, admin accounts and department-level
 *      grants; then the old department is removed (a merged MDA is deactivated
 *      and marked as merged).
 *
 * MDA-level grants on a merged MDA are removed and reported by default, since
 * moving them would give those people authority over the whole merged MDA;
 * keepMdaGrants moves them instead.
 */

type Maps = { departments: Record<string, number>; designations: Record<string, number>; locations: Record<string, number> };

// Tables of the shared modules that carry company_id and department_id
const MODULE_TABLES = [
  "projects", "clients", "finance_accounts", "finance_payees", "finance_payers", "assets", "job_posts",
  "training_programs", "support_tickets", "hr_events", "file_manager_folders", "file_manager_files",
] as const;

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

async function counterpartDepartment(dept: any, targetCompanyId: number): Promise<number> {
  const [found] = await sql`SELECT id FROM departments WHERE company_id = ${targetCompanyId} AND LOWER(TRIM(name)) = ${norm(dept.name)} ORDER BY id LIMIT 1`;
  if (found) return Number(found.id);
  const [created] = await sql`
    INSERT INTO departments (company_id, name, status, created_at) VALUES (${targetCompanyId}, ${dept.name}, ${dept.status ?? "active"}, NOW())
    RETURNING id
  `;
  return Number(created!.id);
}

/** Matching designations and locations in the target MDA for the ones in use, created when missing. */
async function counterpartUnits(designationIds: number[], locationIds: number[], target: { id: number; code: string | null }) {
  const designations: Record<string, number> = {};
  const locations: Record<string, number> = {};
  if (designationIds.length > 0) {
    for (const d of await sql`SELECT * FROM designations WHERE id = ANY(${designationIds}::int[])`) {
      const [found] = await sql`SELECT id FROM designations WHERE company_id = ${target.id} AND LOWER(TRIM(title)) = ${norm(d.title)} ORDER BY id LIMIT 1`;
      designations[String(d.id)] = found
        ? Number(found.id)
        : Number((await sql`
            INSERT INTO designations (company_code, company_id, title, description, status, created_at)
            VALUES (${target.code ?? ""}, ${target.id}, ${d.title}, ${d.description ?? null}, ${d.status ?? "active"}, NOW())
            RETURNING id
          `)[0]!.id);
    }
  }
  if (locationIds.length > 0) {
    for (const l of await sql`SELECT * FROM locations WHERE id = ANY(${locationIds}::int[])`) {
      const [found] = await sql`SELECT id FROM locations WHERE company_id = ${target.id} AND LOWER(TRIM(name)) = ${norm(l.name)} ORDER BY id LIMIT 1`;
      locations[String(l.id)] = found
        ? Number(found.id)
        : Number((await sql`
            INSERT INTO locations (name, address, city, state, country, status, company_code, company_id, created_at)
            VALUES (${l.name}, ${l.address ?? null}, ${l.city ?? null}, ${l.state ?? null}, ${l.country ?? null}, ${l.status ?? "active"}, ${target.code}, ${target.id}, NOW())
            RETURNING id
          `)[0]!.id);
    }
  }
  return { designations, locations };
}

/** Designations and locations used by the people and records being moved. */
async function unitsInUse(sourceCompanyId: number, departmentIds: number[] | null) {
  const depts = departmentIds ?? [];
  const all = departmentIds === null;
  const [row] = await sql`
    SELECT
      ARRAY(SELECT DISTINCT x FROM unnest(
        ARRAY(SELECT designation_id FROM employees WHERE company_id = ${sourceCompanyId} AND (${all}::boolean OR department_id = ANY(${depts}::int[])) AND designation_id IS NOT NULL)
        || ARRAY(SELECT to_designation_id FROM employee_transfers WHERE to_company_id = ${sourceCompanyId} AND status IN ('pending','approved') AND (${all}::boolean OR to_department_id = ANY(${depts}::int[])) AND to_designation_id IS NOT NULL)
        || ARRAY(SELECT designation_id FROM performance_appraisers WHERE department_id = ANY(${depts}::int[]) OR (${all}::boolean AND department_id IN (SELECT id FROM departments WHERE company_id = ${sourceCompanyId})))
        || ARRAY(SELECT designation_id FROM performance_indicators WHERE department_id = ANY(${depts}::int[]) OR (${all}::boolean AND department_id IN (SELECT id FROM departments WHERE company_id = ${sourceCompanyId})))
      ) AS x WHERE x IS NOT NULL) AS designations,
      ARRAY(SELECT DISTINCT x FROM unnest(
        ARRAY(SELECT location_id FROM employees WHERE company_id = ${sourceCompanyId} AND (${all}::boolean OR department_id = ANY(${depts}::int[])) AND location_id IS NOT NULL)
        || ARRAY(SELECT to_location_id FROM employee_transfers WHERE to_company_id = ${sourceCompanyId} AND status IN ('pending','approved') AND (${all}::boolean OR to_department_id = ANY(${depts}::int[])) AND to_location_id IS NOT NULL)
      ) AS x WHERE x IS NOT NULL) AS locations
  `;
  return { designations: (row?.designations ?? []).map(Number), locations: (row?.locations ?? []).map(Number) };
}

/**
 * The statements that move everything from the source (one department, or a
 * whole MDA when departmentIds is null) to the target MDA, using the maps of
 * old to new department, designation and location ids.
 */
function moveStatements(source: number, target: number, targetCode: string | null, departmentIds: number[] | null, maps: Maps, opts: { keepMdaGrants: boolean }) {
  const all = departmentIds === null;
  const depts = departmentIds ?? [];
  const dm = JSON.stringify(maps.departments), gm = JSON.stringify(maps.designations), lm = JSON.stringify(maps.locations);
  const statements: any[] = [
    sql`
      UPDATE employees SET
        company_id = ${target},
        department_id = (${dm}::jsonb ->> department_id::text)::int,
        designation_id = (${gm}::jsonb ->> designation_id::text)::int,
        location_id = (${lm}::jsonb ->> location_id::text)::int,
        updated_at = NOW()
      WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))
    `,
    sql`
      UPDATE employment_info SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int
      WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))
    `,
    sql`
      UPDATE employee_transfers SET
        to_company_id = ${target},
        to_department_id = (${dm}::jsonb ->> to_department_id::text)::int,
        to_designation_id = (${gm}::jsonb ->> to_designation_id::text)::int,
        to_location_id = (${lm}::jsonb ->> to_location_id::text)::int
      WHERE to_company_id = ${source} AND status IN ('pending', 'approved')
        AND (${all}::boolean OR to_department_id = ANY(${depts}::int[]))
    `,
    sql`
      UPDATE performance_appraisers SET
        department_id = COALESCE((${dm}::jsonb ->> department_id::text)::int, department_id),
        designation_id = COALESCE((${gm}::jsonb ->> designation_id::text)::int, designation_id)
      WHERE (${dm}::jsonb ? department_id::text)
    `,
    sql`
      UPDATE performance_indicators SET
        department_id = COALESCE((${dm}::jsonb ->> department_id::text)::int, department_id),
        designation_id = COALESCE((${gm}::jsonb ->> designation_id::text)::int, designation_id)
      WHERE (${dm}::jsonb ? department_id::text)
    `,
    sql`
      UPDATE admin_users SET mda_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int, updated_at = NOW()
      WHERE ${all}::boolean AND mda_id = ${source} OR department_id = ANY(${depts}::int[])
    `,
    // Department-level grants follow their department; a grant the person
    // already holds there is not duplicated
    sql`
      DELETE FROM user_roles ur WHERE (${dm}::jsonb ? ur.department_id::text) AND EXISTS (
        SELECT 1 FROM user_roles t WHERE t.user_id = ur.user_id AND t.role_id = ur.role_id
          AND t.department_id = (${dm}::jsonb ->> ur.department_id::text)::int AND t.id <> ur.id)
    `,
    sql`
      UPDATE user_roles SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int
      WHERE (${dm}::jsonb ? department_id::text)
    `,
    sql`
      DELETE FROM user_permissions up WHERE (${dm}::jsonb ? up.department_id::text) AND EXISTS (
        SELECT 1 FROM user_permissions t WHERE t.user_id = up.user_id AND t.permission_id = up.permission_id
          AND t.department_id = (${dm}::jsonb ->> up.department_id::text)::int AND t.ctid <> up.ctid)
    `,
    sql`
      UPDATE user_permissions SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int
      WHERE (${dm}::jsonb ? department_id::text)
    `,
    // Open requests for temporary access to what is moving are withdrawn
    sql`
      UPDATE access_requests SET status = 'cancelled', decided_at = NOW(), decision_note = 'Withdrawn: the MDA was restructured'
      WHERE status = 'pending' AND company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))
    `,
  ];
  // The shared modules' records (written out so every table name is fixed in the code)
  statements.push(
    sql`UPDATE projects SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE clients SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE finance_accounts SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE finance_payees SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE finance_payers SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE assets SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE job_posts SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE training_programs SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE support_tickets SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE hr_events SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE file_manager_folders SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`,
    sql`UPDATE file_manager_files SET company_id = ${target}, department_id = (${dm}::jsonb ->> department_id::text)::int WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[]))`
  );
  if (all) {
    statements.push(
      opts.keepMdaGrants
        ? sql`
            DELETE FROM user_roles ur WHERE ur.company_id = ${source} AND ur.department_id IS NULL AND EXISTS (
              SELECT 1 FROM user_roles t WHERE t.user_id = ur.user_id AND t.role_id = ur.role_id AND t.company_id = ${target} AND t.department_id IS NULL)
          `
        : sql`DELETE FROM user_roles WHERE company_id = ${source} AND department_id IS NULL`,
      opts.keepMdaGrants
        ? sql`UPDATE user_roles SET company_id = ${target} WHERE company_id = ${source} AND department_id IS NULL`
        : sql`SELECT 1`,
      opts.keepMdaGrants
        ? sql`
            DELETE FROM user_permissions up WHERE up.company_id = ${source} AND up.department_id IS NULL AND EXISTS (
              SELECT 1 FROM user_permissions t WHERE t.user_id = up.user_id AND t.permission_id = up.permission_id AND t.company_id = ${target} AND t.department_id IS NULL)
          `
        : sql`DELETE FROM user_permissions WHERE company_id = ${source} AND department_id IS NULL`,
      opts.keepMdaGrants
        ? sql`UPDATE user_permissions SET company_id = ${target} WHERE company_id = ${source} AND department_id IS NULL`
        : sql`SELECT 1`,
      sql`UPDATE announcements SET company_id = ${target}, company_code = ${targetCode} WHERE company_id = ${source}`,
      sql`UPDATE company_policies SET company_id = ${target}, company_code = ${targetCode} WHERE company_id = ${source}`,
      sql`UPDATE companies SET status = 'inactive', merged_into_company_id = ${target}, merged_at = NOW(), updated_at = NOW() WHERE id = ${source}`
    );
  }
  // The old departments are now empty; a department merged into an existing one is removed
  const oldDepartments = Object.entries(maps.departments).filter(([from, to]) => Number(from) !== to).map(([from]) => Number(from));
  statements.push(sql`DELETE FROM departments WHERE id = ANY(${oldDepartments}::int[])`);
  return statements;
}

async function counts(source: number, departmentIds: number[] | null) {
  const all = departmentIds === null;
  const depts = departmentIds ?? [];
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM employees WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[])))::int AS employees,
      (SELECT COUNT(*) FROM employment_info WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[])))::int AS registrations,
      (SELECT COUNT(*) FROM admin_users WHERE (${all}::boolean AND mda_id = ${source}) OR department_id = ANY(${depts}::int[]))::int AS admin_accounts,
      (SELECT COUNT(*) FROM user_roles WHERE company_id = ${source} AND (${all}::boolean OR department_id = ANY(${depts}::int[])))::int AS role_assignments,
      (SELECT COUNT(*) FROM user_roles WHERE ${all}::boolean AND company_id = ${source} AND department_id IS NULL)::int AS mda_level_role_assignments
  `;
  let records = 0;
  for (const t of MODULE_TABLES) {
    const [r] = await sql.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE company_id = $1 AND ($2::boolean OR department_id = ANY($3::int[]))`, [source, all, depts]);
    records += Number(r?.n ?? 0);
  }
  return { ...row, module_records: records };
}

export type RestructureResult =
  | { ok: true; dryRun: boolean; summary: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Moves one department, with its people and records, to another MDA. */
export async function moveDepartment(
  req: NextRequest, ctx: AuthContext, departmentId: number, targetCompanyId: number, reason: string, dryRun: boolean
): Promise<RestructureResult> {
  const [dept] = await sql`SELECT * FROM departments WHERE id = ${departmentId}`;
  if (!dept) return { ok: false, status: 404, error: "Department not found" };
  const [target] = await sql`SELECT id, name, company_code, status FROM companies WHERE id = ${targetCompanyId}`;
  if (!target || String(target.status ?? "active").toLowerCase() !== "active") return { ok: false, status: 400, error: "The destination must be an active MDA" };
  const source = Number(dept.company_id);
  if (source === targetCompanyId) return { ok: false, status: 400, error: "The department is already in that MDA" };

  const affected = await counts(source, [departmentId]);
  if (dryRun) return { ok: true, dryRun, summary: { department: dept.name, from: source, to: target.name, ...affected } };

  const newDepartment = await counterpartDepartment(dept, targetCompanyId);
  const used = await unitsInUse(source, [departmentId]);
  const units = await counterpartUnits(used.designations, used.locations, { id: targetCompanyId, code: target.company_code ?? null });
  const maps: Maps = { departments: { [String(departmentId)]: newDepartment }, ...units };

  await runAudited(req, ctx, {
    action: "organization.department.moved", targetType: "department", targetId: departmentId, reason,
    details: { from_company_id: source, to_company_id: targetCompanyId, new_department_id: newDepartment, ...affected },
  }, moveStatements(source, targetCompanyId, target.company_code ?? null, [departmentId], maps, { keepMdaGrants: false }));
  return { ok: true, dryRun, summary: { department: dept.name, new_department_id: newDepartment, to: target.name, ...affected } };
}

/** Merges one MDA into another: its departments, people, records and (optionally) MDA-level access. */
export async function mergeMda(
  req: NextRequest, ctx: AuthContext, sourceCompanyId: number, targetCompanyId: number, reason: string, dryRun: boolean, keepMdaGrants: boolean
): Promise<RestructureResult> {
  if (sourceCompanyId === targetCompanyId) return { ok: false, status: 400, error: "An MDA cannot be merged into itself" };
  const [source] = await sql`SELECT id, name, status FROM companies WHERE id = ${sourceCompanyId}`;
  const [target] = await sql`SELECT id, name, company_code, status FROM companies WHERE id = ${targetCompanyId}`;
  if (!source) return { ok: false, status: 404, error: "The MDA to merge was not found" };
  if (!target || String(target.status ?? "active").toLowerCase() !== "active") return { ok: false, status: 400, error: "The destination must be an active MDA" };

  const affected = await counts(sourceCompanyId, null);
  const departments = await sql`SELECT * FROM departments WHERE company_id = ${sourceCompanyId}`;
  if (dryRun) {
    return { ok: true, dryRun, summary: { from: source.name, into: target.name, departments: departments.length, mda_level_grants: keepMdaGrants ? "moved" : "removed", ...affected } };
  }

  const map: Record<string, number> = {};
  for (const d of departments) map[String(d.id)] = await counterpartDepartment(d, targetCompanyId);
  const used = await unitsInUse(sourceCompanyId, null);
  const units = await counterpartUnits(used.designations, used.locations, { id: targetCompanyId, code: target.company_code ?? null });
  const removedGrants = keepMdaGrants ? [] : await sql`
    SELECT ur.user_id, u.username, r.key AS role FROM user_roles ur JOIN roles r ON r.id = ur.role_id LEFT JOIN admin_users u ON u.id::text = ur.user_id
    WHERE ur.company_id = ${sourceCompanyId} AND ur.department_id IS NULL
  `;

  await runAudited(req, ctx, {
    action: "organization.mda.merged", targetType: "mda", targetId: sourceCompanyId, reason,
    details: { into_company_id: targetCompanyId, departments: map, mda_level_grants: keepMdaGrants ? "moved" : removedGrants, ...affected },
  }, moveStatements(sourceCompanyId, targetCompanyId, target.company_code ?? null, null, { departments: map, ...units }, { keepMdaGrants }));

  return {
    ok: true, dryRun,
    summary: {
      from: source.name, into: target.name, departments: map, ...affected,
      mda_level_grants_removed: keepMdaGrants ? [] : removedGrants.map((g: any) => `${g.username ?? g.user_id}: ${g.role}`),
    },
  };
}
