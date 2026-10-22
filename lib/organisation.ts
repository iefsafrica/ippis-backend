import { neon } from "@neondatabase/serverless";
import { covers, type AuthContext } from "@/lib/rbac";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Shared rules for the organisation structure routes (MDAs are rows of
 * `companies`). Records point at their MDA by companies.id; the MDA code is
 * kept alongside because the frontend sends it.
 */

export const MANAGE = "organization.structure.manage";

export type Mda = { id: number; name: string; company_code: string | null; status: string | null };

/** True when the caller may change the structure of this MDA (null = no MDA: global rights only). */
export function managesMda(ctx: AuthContext, companyId: number | null) {
  return covers(ctx, MANAGE, { level: "mda", companyId, departmentId: null });
}

/**
 * The MDA a request refers to, by company_id / mda_id or by company_code.
 * Both may be sent, but then they must name the same MDA.
 */
export async function resolveMda(body: {
  company_id?: unknown;
  mda_id?: unknown;
  company_code?: unknown;
}): Promise<{ company: Mda } | { error: string; status: number }> {
  const rawId = body.company_id ?? body.mda_id;
  const id = rawId === undefined || rawId === null || rawId === "" ? null : Number(rawId);
  const code = typeof body.company_code === "string" && body.company_code.trim() ? body.company_code.trim() : null;

  if (id === null && code === null) {
    return { error: "company_id or company_code (the MDA) is required", status: 400 };
  }
  if (id !== null && (!Number.isInteger(id) || id <= 0)) {
    return { error: "company_id is not valid", status: 400 };
  }

  const rows = id !== null
    ? await sql`SELECT id, name, company_code, status FROM companies WHERE id = ${id}`
    : await sql`SELECT id, name, company_code, status FROM companies WHERE TRIM(company_code) = ${code}`;
  const company = rows[0] as Mda | undefined;
  if (!company) return { error: "MDA not found", status: 404 };
  if (id !== null && code !== null && (company.company_code ?? "").trim() !== code) {
    return { error: "company_id and company_code name different MDAs", status: 400 };
  }
  return { company: { ...company, id: Number(company.id) } };
}

/** The MDA id of an existing record that stores company_id and/or company_code. */
export async function mdaIdOf(row: { company_id?: unknown; company_code?: unknown } | undefined): Promise<number | null> {
  if (!row) return null;
  if (row.company_id != null) return Number(row.company_id);
  if (typeof row.company_code !== "string") return null;
  const found = await sql`SELECT id FROM companies WHERE TRIM(company_code) = TRIM(${row.company_code})`;
  return found[0] ? Number(found[0].id) : null;
}
