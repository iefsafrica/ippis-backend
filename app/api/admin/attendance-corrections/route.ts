import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { shiftFor, arrivalStatus } from "@/lib/employee-attendance";
import { notify } from "@/lib/employee-notifications";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const STATUSES = ["pending", "approved", "rejected", "cancelled"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=pending (default) | approved | rejected | cancelled | all   ?employee_id=
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";
    const employeeId = searchParams.get("employee_id");
    if (status !== "all" && !STATUSES.includes(status)) {
      return withCors(req, { success: false, error: `status must be one of: ${[...STATUSES, "all"].join(", ")}` }, 400);
    }
    const filter = status === "all" ? null : status;
    const sc = recordScope(auth.ctx, "timesheets.attendance.view");

    const rows = await db`
      SELECT c.id, c.employee_id, e.name AS employee_name, e.department, c.attendance_date::text AS attendance_date,
             c.requested_clock_in::text AS requested_clock_in, c.requested_clock_out::text AS requested_clock_out,
             a.clock_in::text AS current_clock_in, a.clock_out::text AS current_clock_out,
             c.reason, c.status, c.reviewed_by, c.reviewed_at, c.review_note, c.created_at
      FROM attendance_corrections c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN LATERAL (
        SELECT clock_in, clock_out FROM attendance
        WHERE employee_code = c.employee_id AND attendance_date::text = c.attendance_date::text
        ORDER BY id DESC LIMIT 1
      ) a ON TRUE
      WHERE (${filter}::text IS NULL OR c.status = ${filter})
        AND (${employeeId}::text IS NULL OR c.employee_id = ${employeeId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY c.created_at ASC
      LIMIT 200
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST ATTENDANCE CORRECTIONS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch attendance corrections" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject", note? }  (note required to reject)
// Approving writes the requested times onto that day's attendance record.
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

    const rows = await db`
      SELECT c.id, c.employee_id, c.attendance_date::text AS date, c.requested_clock_in::text AS clock_in,
             c.requested_clock_out::text AS clock_out, c.status, e.name, e.department
      FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id
      WHERE c.id = ${id}
    `;
    const c = rows[0];
    if (!c || !(await employeeInScope(auth.ctx, "timesheets.attendance.manage", c.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }
    if (c.status !== "pending") return withCors(req, { success: false, error: `This correction is already ${c.status}` }, 409);

    const outcome = body.decision === "approve" ? "approved" : "rejected";
    const statements = [
      db`
        UPDATE attendance_corrections
        SET status = ${outcome}, reviewed_by = ${auth.ctx.user.username}, reviewed_at = NOW(), review_note = ${note}, updated_at = NOW()
        WHERE id = ${id} AND status = 'pending'
      `,
      // Aborts the transaction unless this request made the decision above
      db`
        SELECT 1 / (SELECT COUNT(*)::int FROM attendance_corrections
                    WHERE id = ${id} AND status = ${outcome} AND reviewed_at = NOW()) AS claimed
      `,
    ];

    if (outcome === "approved") {
      const clockIn = c.clock_in ? String(c.clock_in).slice(0, 8) : null;
      const clockOut = c.clock_out ? String(c.clock_out).slice(0, 8) : null;
      const status = clockIn ? arrivalStatus(clockIn, await shiftFor(c.department)) : "present";
      statements.push(
        db`
          UPDATE attendance
          SET clock_in = COALESCE(${clockIn}, clock_in),
              clock_out = COALESCE(${clockOut}, clock_out),
              status = CASE WHEN ${clockIn}::text IS NOT NULL OR LOWER(COALESCE(status, '')) IN ('', 'absent') THEN ${status} ELSE status END
          WHERE employee_code = ${c.employee_id} AND attendance_date::text = ${c.date}
        `,
        db`
          INSERT INTO attendance (employee_code, employee_name, department, attendance_date, clock_in, clock_out, status, notes)
          SELECT ${c.employee_id}, ${c.name}, ${c.department}, ${c.date}, ${clockIn}, ${clockOut}, ${status}, 'Added by approved correction'
          WHERE NOT EXISTS (
            SELECT 1 FROM attendance WHERE employee_code = ${c.employee_id} AND attendance_date::text = ${c.date}
          )
        `
      );
    }

    try {
      await runAudited(
        req,
        auth.ctx,
        { action: `timesheets.attendance_correction.${outcome}`, targetType: "employee", targetId: c.employee_id, reason: note, details: { correction_id: id, date: c.date } },
        statements
      );
    } catch (error: any) {
      if (error?.code === "22012") return withCors(req, { success: false, error: "This correction was decided by someone else" }, 409);
      throw error;
    }

    await notify(String(c.employee_id), "attendance", {
      title: `Attendance correction ${outcome}`,
      message: outcome === "approved"
        ? `Your correction for ${c.date} was approved and your attendance updated.`
        : `Your correction for ${c.date} was rejected: ${note}`,
      link: "/employee/attendance",
    });

    return withCors(req, { success: true, message: `Correction ${outcome}` });
  } catch (error) {
    console.error("DECIDE ATTENDANCE CORRECTION ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the correction" }, 500);
  }
}
