import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, readReason, scopeOf } from "@/lib/rbac";
import { moveDepartment, mergeMda } from "@/lib/org-restructure";

export const dynamic = "force-dynamic";

const MANAGE = "organization.structure.manage";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body, one of:
//   { action: "move_department", department_id, to_company_id, reason, dry_run? }
//   { action: "merge_mda", from_company_id, into_company_id, reason, keep_mda_grants?, dry_run? }
// Restructuring changes several MDAs at once, so it needs organisation rights
// across all MDAs. dry_run reports what would move without changing anything.
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    if (!scopeOf(auth.ctx, MANAGE).global) {
      return withCors(req, { success: false, error: "Restructuring MDAs needs organisation rights across all MDAs" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = readReason(body.reason);
    const dryRun = body.dry_run === true;
    if (!reason && !dryRun) return withCors(req, { success: false, error: "A reason is required" }, 400);

    let result;
    if (body.action === "move_department") {
      const departmentId = Number(body.department_id), to = Number(body.to_company_id ?? body.to_mda_id);
      if (!Number.isInteger(departmentId) || !Number.isInteger(to)) {
        return withCors(req, { success: false, error: "department_id and to_company_id are required" }, 400);
      }
      result = await moveDepartment(req, auth.ctx, departmentId, to, reason ?? "", dryRun);
    } else if (body.action === "merge_mda") {
      const from = Number(body.from_company_id), into = Number(body.into_company_id);
      if (!Number.isInteger(from) || !Number.isInteger(into)) {
        return withCors(req, { success: false, error: "from_company_id and into_company_id are required" }, 400);
      }
      result = await mergeMda(req, auth.ctx, from, into, reason ?? "", dryRun, body.keep_mda_grants === true);
    } else {
      return withCors(req, { success: false, error: "action must be move_department or merge_mda" }, 400);
    }

    if (!result.ok) return withCors(req, { success: false, error: result.error }, result.status);
    return withCors(req, {
      success: true,
      message: result.dryRun ? "Dry run: nothing was changed" : "Restructuring done",
      data: result.summary,
    });
  } catch (error: any) {
    // Something still points at the old units: nothing was moved
    if (error?.code === "23503" || error?.code === "23505" || error?.code === "23514") {
      console.error("RESTRUCTURE CONFLICT:", error);
      return withCors(req, { success: false, error: "Nothing was changed: some records could not be moved", details: error?.detail ?? error?.message }, 409);
    }
    console.error("RESTRUCTURE ERROR:", error);
    return withCors(req, { success: false, error: "Restructuring failed; nothing was changed" }, 500);
  }
}
