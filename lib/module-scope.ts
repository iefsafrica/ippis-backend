import { neon } from "@neondatabase/serverless";
import { can, type AuthContext } from "@/lib/rbac";
import { recordScope, inScope, OUT_OF_SCOPE, type RecordScope } from "@/lib/mda-scope";

const sql = neon(process.env.DATABASE_URL!);

/**
 * MDA ownership for the records of the shared modules (projects, finance,
 * assets, recruitment, training, support tickets, clients, invoices, calendar
 * events, the file manager). Each record carries company_id (its MDA) and an
 * optional department_id, like employees (database/mda-completion-migration.sql).
 *
 * - Seeing a record needs the module's view permission over its MDA or
 *   department. Records without an MDA are either central (seen by users with
 *   rights across all MDAs only) or shared with everyone, depending on the
 *   module ("shared" below).
 * - Creating a record puts it in an MDA inside the caller's scope: the one
 *   named in the request, or the caller's only MDA (or department).
 * - Changing, approving or deleting a record needs the permission over its
 *   MDA; shared records without an MDA are changed by central users only.
 * - Child records (tasks, expenses, candidates...) take the MDA of their parent.
 *
 * In SQL, filter a query whose table is aliased `t` with:
 *   AND (${sc.all}::boolean OR t.company_id = ANY(${sc.companyIds}::int[])
 *        OR t.department_id = ANY(${sc.departmentIds}::int[]) OR (${shared}::boolean AND t.company_id IS NULL))
 */

export { OUT_OF_SCOPE };
export type Placement = { companyId: number | null; departmentId: number | null };
type Row = { company_id?: unknown; department_id?: unknown } | null | undefined;

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export function moduleScope(ctx: AuthContext, key: string): RecordScope {
  return recordScope(ctx, key);
}

/** Whether the caller may see the record. */
export function canSee(ctx: AuthContext, key: string, row: Row, shared = false) {
  if (!row) return false;
  const sc = recordScope(ctx, key);
  return sc.all || inScope(sc, row.company_id, row.department_id) || (shared && num(row.company_id) === null);
}

/** Whether the caller may change, approve or delete the record. */
export function canChange(ctx: AuthContext, key: string, row: Row) {
  if (!row || !can(ctx, key)) return false;
  const sc = recordScope(ctx, key);
  return sc.all || inScope(sc, row.company_id, row.department_id);
}

/** Keeps the rows the caller may see (for short, unpaginated lists). */
export function visibleRows<T extends Record<string, any>>(ctx: AuthContext, key: string, rows: T[], shared = false): T[] {
  return rows.filter((r) => canSee(ctx, key, r, shared));
}

/**
 * Where a new record goes, or where an existing one moves to (company_id or
 * mda_id, and department_id, in the request). With nothing named, a new record
 * goes to the caller's only MDA or department; central users may leave it
 * without an MDA. An existing record keeps its place.
 */
export async function placementFor(
  ctx: AuthContext,
  key: string,
  body: Record<string, unknown>,
  current?: Placement
): Promise<{ ok: true; placement: Placement; changed: boolean } | { ok: false; status: number; error: string }> {
  const sc = recordScope(ctx, key);
  const companyGiven = num(body.company_id ?? body.mda_id);
  const departmentGiven = num(body.department_id);

  if (companyGiven === null && departmentGiven === null) {
    if (current) return { ok: true, placement: current, changed: false };
    if (sc.all) return { ok: true, placement: { companyId: null, departmentId: null }, changed: true };
    if (sc.companyIds.length === 1 && sc.departmentIds.length === 0) {
      return { ok: true, placement: { companyId: sc.companyIds[0]!, departmentId: null }, changed: true };
    }
    if (sc.departmentIds.length === 1 && sc.companyIds.length === 0) {
      const [d] = await sql`SELECT company_id FROM departments WHERE id = ${sc.departmentIds[0]!}`;
      if (d) return { ok: true, placement: { companyId: Number(d.company_id), departmentId: sc.departmentIds[0]! }, changed: true };
    }
    return { ok: false, status: 400, error: "company_id (the MDA) is required" };
  }

  for (const v of [companyGiven, departmentGiven]) {
    if (v !== null && (!Number.isInteger(v) || v <= 0)) return { ok: false, status: 400, error: "company_id / department_id are not valid" };
  }
  let companyId = companyGiven;
  if (departmentGiven !== null) {
    const [d] = await sql`SELECT id, company_id FROM departments WHERE id = ${departmentGiven}`;
    if (!d) return { ok: false, status: 400, error: "Department not found" };
    if (companyId !== null && Number(d.company_id) !== companyId) {
      return { ok: false, status: 400, error: "That department does not belong to that MDA" };
    }
    companyId = Number(d.company_id);
  }
  const [mda] = await sql`SELECT id, status FROM companies WHERE id = ${companyId}`;
  if (!mda || String(mda.status ?? "active").toLowerCase() !== "active") {
    return { ok: false, status: 400, error: "company_id must be an active MDA" };
  }
  const placement = { companyId, departmentId: departmentGiven };
  if (!sc.all && !inScope(sc, placement.companyId, placement.departmentId)) {
    return { ok: false, status: 403, error: "That MDA or department is outside your organisational scope" };
  }
  const changed = !current || current.companyId !== placement.companyId || current.departmentId !== placement.departmentId;
  return { ok: true, placement, changed };
}

export function placementOf(row: Row): Placement {
  return { companyId: num(row?.company_id), departmentId: num(row?.department_id) };
}

/** The MDA of a child record's parent: a finance account, a job post or a project. */
export async function parentOf(kind: "account" | "job" | "project", id: unknown): Promise<Row> {
  if (id === undefined || id === null || id === "") return null;
  const key = String(id);
  const [row] =
    kind === "account"
      ? await sql`SELECT company_id, department_id FROM finance_accounts WHERE account_id = ${key}`
      : kind === "job"
        ? await sql`SELECT company_id, department_id FROM job_posts WHERE id::text = ${key}`
        : await sql`SELECT company_id, department_id FROM projects WHERE id::text = ${key}`;
  return row ?? null;
}
