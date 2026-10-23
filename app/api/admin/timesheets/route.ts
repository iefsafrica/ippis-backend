import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const STATUSES = ["submitted", "approved", "rejected"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=submitted (default) | approved | rejected | all   ?employee_id=
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "submitted";
    const employeeId = searchParams.get("employee_id");
    if (status !== "all" && !STATUSES.includes(status)) {
      return withCors(req, { success: false, error: `status must be one of: ${[...STATUSES, "all"].join(", ")}` }, 400);
    }
    const filter = status === "all" ? null : status;
    const sc = recordScope(auth.ctx, "timesheets.attendance.view");

    const rows = await db`
      SELECT t.id, t.employee_id, e.name AS employee_name, e.department, t.week_start::text AS week_start,
             t.entries, t.total_hours, t.employee_note, t.status, t.reviewed_by, t.reviewed_at, t.review_note, t.submitted_at
      FROM employee_timesheets t JOIN employees e ON e.id = t.employee_id
      WHERE (${filter}::text IS NULL OR t.status = ${filter})
        AND (${employeeId}::text IS NULL OR t.employee_id = ${employeeId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY t.submitted_at ASC
      LIMIT 200
    `;
    return withCors(req, { success: true, data: rows.map((r: any) => ({ ...r, total_hours: Number(r.total_hours) })) });
  } catch (error) {
    console.error("LIST TIMESHEETS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch timesheets" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject", note? }  (note required to reject)
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const note = readReason(body.note);
    if (!Number.isInteger(id) || id <= 0 || (body.decision !== "approve" && body.decision !== "reject")) {
      return withCors(req, { success: false, error: "id and decision (approve or reject) are required" }, 400);
    }
    if (body.decision === "reject" && !note) {
      return withCors(req, { success: false, error: "A note is required when rejecting" }, 400);
    }
    const outcome = body.decision === "approve" ? "approved" : "rejected";

    const [sheetOwner] = await db`SELECT employee_id FROM employee_timesheets WHERE id = ${id}`;
    if (!sheetOwner || !(await employeeInScope(auth.ctx, "timesheets.attendance.manage", sheetOwner.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: `timesheets.timesheet.${outcome}`, targetType: "timesheet", targetId: id, reason: note, details: {} },
      [
        db`
          UPDATE employee_timesheets
          SET status = ${outcome}, reviewed_by = ${auth.ctx.user.username}, reviewed_at = NOW(), review_note = ${note}, updated_at = NOW()
          WHERE id = ${id} AND status = 'submitted'
          RETURNING employee_id, week_start::text AS week_start
        `,
        // Aborts the transaction (and its audit entry) unless the update above matched
        db`
          SELECT 1 / (SELECT COUNT(*)::int FROM employee_timesheets
                      WHERE id = ${id} AND status = ${outcome} AND reviewed_at = NOW()) AS claimed
        `,
      ]
    ).catch((error: any) => {
      if (error?.code === "22012") return [[]];
      throw error;
    });

    const sheet = updated?.[0];
    if (!sheet) {
      return withCors(req, { success: false, error: "Timesheet not found or already decided" }, 409);
    }

    await notify(String(sheet.employee_id), "attendance", {
      title: `Timesheet ${outcome}`,
      message: outcome === "approved"
        ? `Your timesheet for the week of ${sheet.week_start} was approved.`
        : `Your timesheet for the week of ${sheet.week_start} was rejected: ${note}`,
      link: "/employee/timesheets",
    });

    return withCors(req, { success: true, message: `Timesheet ${outcome}` });
  } catch (error) {
    console.error("DECIDE TIMESHEET ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the timesheet" }, 500);
  }
}
