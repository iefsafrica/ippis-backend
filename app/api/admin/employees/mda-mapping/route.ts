import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, scopeOf, readReason } from "@/lib/rbac";
import {
  loadDirectory,
  loadEmployeeOrgRows,
  suggest,
  normaliseName,
  matchDepartment,
  type Suggestion,
} from "@/lib/employee-mda";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

/**
 * Linking existing employees to their MDA.
 *
 * Employees without an MDA belong to no MDA scope, so only people with
 * employee rights across all MDAs can see or link them (ORG-08). Linking fills
 * empty links only; moving a linked employee to another MDA is a transfer and
 * needs `correction: true` with a reason.
 */

const VIEW = "employees.records.view";
const UPDATE = "employees.records.update";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function globalOnly(req: NextRequest, ctx: Parameters<typeof scopeOf>[0], key: string) {
  if (scopeOf(ctx, key).global) return null;
  return withCors(req, { success: false, error: "Linking employees to MDAs needs employee rights across all MDAs" }, 403);
}

function label(dir: Awaited<ReturnType<typeof loadDirectory>>, s: Suggestion) {
  if (s.status !== "linked" && s.status !== "matched") return { mda: null, department: null };
  const mda = dir.mdas.find((m) => m.id === s.companyId);
  const dept = s.departmentId == null ? null : dir.departments.find((d) => d.id === s.departmentId);
  return {
    mda: mda ? { id: mda.id, name: mda.name, code: mda.company_code } : null,
    department: dept ? { id: dept.id, name: dept.name } : null,
  };
}

// ?status=linked|matched|ambiguous|unmatched|missing  ?page= &limit=
// A read-only report: how every employee's registration text matches the
// official MDA list, grouped by the distinct ministry names to map.
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;
    const refused = globalOnly(req, auth.ctx, VIEW);
    if (refused) return refused;

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || "50") || 50));

    const [dir, rows] = await Promise.all([loadDirectory(), loadEmployeeOrgRows()]);
    const analysed = rows.map((row) => ({ row, s: suggest(dir, row) }));

    const summary = { total: rows.length, linked: 0, matched: 0, ambiguous: 0, unmatched: 0, missing: 0, matchedWithoutDepartment: 0 };
    const values = new Map<string, { text: string; employees: number; status: string; suggestion: ReturnType<typeof label>["mda"]; reason?: string }>();

    for (const { row, s } of analysed) {
      summary[s.status]++;
      if (s.status === "matched" && s.departmentId == null) summary.matchedWithoutDepartment++;
      if (s.status === "linked") continue;
      // Group the unlinked by the ministry text, so HR maps each spelling once
      const key = normaliseName(row.organization) || "(none)";
      const entry = values.get(key) ?? {
        text: row.organization ?? "(none)",
        employees: 0,
        status: s.status,
        suggestion: label(dir, s).mda,
        ...("reason" in s ? { reason: s.reason } : {}),
      };
      entry.employees++;
      values.set(key, entry);
    }

    const filtered = analysed.filter(({ s }) => !statusFilter || s.status === statusFilter);
    const employees = filtered.slice((page - 1) * limit, page * limit).map(({ row, s }) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      registration: { ministry: row.organization, department: row.department_text },
      link: s.status,
      ...label(dir, s),
      ...(s.status === "matched" ? { source: s.source } : {}),
      ...("reason" in s ? { reason: s.reason } : {}),
    }));

    return withCors(req, {
      success: true,
      data: {
        summary,
        // The distinct ministry spellings still to link, most common first
        ministryValues: [...values.values()].sort((a, b) => b.employees - a.employees),
        employees,
        pagination: { total: filtered.length, page, limit },
      },
    });
  } catch (error) {
    console.error("EMPLOYEE MDA REPORT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to build the MDA report" }, 500);
  }
}

type Link = { employeeId: string; companyId: number; departmentId: number | null };

async function applyLinks(links: Link[], by: string, opts: { correction?: boolean } = {}) {
  if (links.length === 0) return 0;
  const payload = JSON.stringify(links.map((l) => ({ id: l.employeeId, company_id: l.companyId, department_id: l.departmentId })));
  const rows = await db`
    UPDATE employees e
    SET company_id = x.company_id,
        department_id = x.department_id,
        designation_id = CASE WHEN e.company_id IS DISTINCT FROM x.company_id THEN NULL ELSE e.designation_id END,
        location_id = CASE WHEN e.company_id IS DISTINCT FROM x.company_id THEN NULL ELSE e.location_id END,
        mda_linked_at = NOW(),
        mda_linked_by = ${by}
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(id text, company_id int, department_id int)
    WHERE e.id = x.id
      AND (e.company_id IS NULL OR ${opts.correction === true})
    RETURNING e.id
  `;
  return rows.length;
}

// Body, one of:
//   { action: "auto", dry_run? }
//       links every unlinked employee whose registration names exactly one MDA
//   { action: "map_value", ministry: "<text as registered>", company_id, dry_run? }
//       links every unlinked employee who registered that ministry text
//   { action: "assign", employee_ids: [...], company_id, department_id?, correction?, reason? }
//       links chosen employees; correction: true (with a reason) moves employees
//       who are already linked
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, UPDATE);
    if (!auth.ok) return auth.response;
    const refused = globalOnly(req, auth.ctx, UPDATE);
    if (refused) return refused;

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const dryRun = body.dry_run === true;
    const by = auth.ctx.user.username;
    const dir = await loadDirectory();

    const mdaFor = (id: unknown) => {
      const n = Number(id);
      return Number.isInteger(n) ? dir.mdas.find((m) => m.id === n) ?? null : null;
    };

    if (body.action === "auto") {
      const rows = await loadEmployeeOrgRows();
      const links: Link[] = [];
      for (const row of rows) {
        const s = suggest(dir, row);
        if (s.status === "matched") links.push({ employeeId: row.id, companyId: s.companyId, departmentId: s.departmentId });
      }
      if (dryRun) return withCors(req, { success: true, data: { dry_run: true, would_link: links.length } });

      const linked = await applyLinks(links, by);
      await runAudited(req, auth.ctx, {
        action: "employees.mda.auto_linked", targetType: "employee", targetId: null,
        details: { linked, matched: links.length },
      }, []);
      return withCors(req, { success: true, message: `${linked} employee(s) linked to their MDA`, data: { linked } });
    }

    if (body.action === "map_value") {
      const wanted = normaliseName(body.ministry);
      const mda = mdaFor(body.company_id);
      if (!wanted) return withCors(req, { success: false, error: "ministry (the text as registered) is required" }, 400);
      if (!mda) return withCors(req, { success: false, error: "company_id must be an existing MDA" }, 400);

      const rows = (await loadEmployeeOrgRows()).filter((r) => r.company_id == null && normaliseName(r.organization) === wanted);
      const links = rows.map((r) => ({
        employeeId: r.id,
        companyId: mda.id,
        departmentId: matchDepartment(dir, mda.id, r.department_text)?.id ?? null,
      }));
      if (dryRun) {
        return withCors(req, { success: true, data: { dry_run: true, would_link: links.length, with_department: links.filter((l) => l.departmentId).length } });
      }

      const linked = await applyLinks(links, by);
      await runAudited(req, auth.ctx, {
        action: "employees.mda.value_mapped", targetType: "mda", targetId: mda.id,
        details: { ministry_text: body.ministry, mda: mda.name, linked },
      }, []);
      return withCors(req, {
        success: true,
        message: `${linked} employee(s) who registered '${body.ministry}' linked to ${mda.name}`,
        data: { linked, with_department: links.filter((l) => l.departmentId).length },
      });
    }

    if (body.action === "assign") {
      const ids = Array.isArray(body.employee_ids) ? [...new Set(body.employee_ids.map((x: unknown) => String(x).trim()).filter(Boolean))] as string[] : [];
      const mda = mdaFor(body.company_id);
      if (ids.length === 0 || ids.length > 500) return withCors(req, { success: false, error: "employee_ids must list 1 to 500 employees" }, 400);
      if (!mda) return withCors(req, { success: false, error: "company_id must be an existing MDA" }, 400);

      let departmentId: number | null = null;
      if (body.department_id !== undefined && body.department_id !== null && body.department_id !== "") {
        const dept = dir.departments.find((d) => d.id === Number(body.department_id));
        if (!dept) return withCors(req, { success: false, error: "Department not found" }, 404);
        if (dept.company_id !== mda.id) return withCors(req, { success: false, error: `That department does not belong to ${mda.name}` }, 400);
        departmentId = dept.id;
      }

      const correction = body.correction === true;
      const reason = readReason(body.reason);
      if (correction && !reason) return withCors(req, { success: false, error: "A reason is required to move employees who are already linked" }, 400);

      const rows = await loadEmployeeOrgRows(ids);
      const missing = ids.filter((id) => !rows.some((r) => r.id === id));
      if (missing.length > 0) return withCors(req, { success: false, error: `Employee(s) not found: ${missing.join(", ")}` }, 404);
      const alreadyElsewhere = rows.filter((r) => r.company_id != null && r.company_id !== mda.id);
      if (alreadyElsewhere.length > 0 && !correction) {
        return withCors(req, {
          success: false,
          error: "Some employees are already linked to another MDA. Use a transfer, or send correction: true with a reason if the link was wrong.",
          employees: alreadyElsewhere.map((r) => r.id),
        }, 409);
      }
      if (dryRun) return withCors(req, { success: true, data: { dry_run: true, would_link: rows.length } });

      const linked = await applyLinks(rows.map((r) => ({ employeeId: r.id, companyId: mda.id, departmentId })), by, { correction: true });
      await runAudited(req, auth.ctx, {
        action: correction ? "employees.mda.corrected" : "employees.mda.assigned",
        targetType: "mda", targetId: mda.id, reason,
        details: { employees: ids, mda: mda.name, department_id: departmentId, moved: alreadyElsewhere.map((r) => ({ id: r.id, from: r.company_id })) },
      }, []);
      return withCors(req, { success: true, message: `${linked} employee(s) linked to ${mda.name}`, data: { linked } });
    }

    return withCors(req, { success: false, error: "action must be auto, map_value or assign" }, 400);
  } catch (error: any) {
    // The database refuses a department, designation or location from another MDA
    if (error?.code === "23503" || error?.code === "23514") {
      return withCors(req, { success: false, error: "That department, designation or location does not belong to the chosen MDA" }, 400);
    }
    console.error("EMPLOYEE MDA LINK ERROR:", error);
    return withCors(req, { success: false, error: "Failed to link employees" }, 500);
  }
}
