import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { todayLagos, isDate, addDays, normaliseTime } from "@/lib/employee-time";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// How far back a correction can be requested
const MAX_DAYS_BACK = 30;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT id, attendance_date::text AS attendance_date, requested_clock_in::text AS requested_clock_in,
             requested_clock_out::text AS requested_clock_out, reason, status, review_note, reviewed_at, created_at
      FROM attendance_corrections
      WHERE employee_id = ${auth.ctx.employee.id}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("ATTENDANCE CORRECTIONS LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your correction requests" }, 500);
  }
}

// Body: { date: "YYYY-MM-DD", clock_in?: "HH:MM", clock_out?: "HH:MM", reason }
// For a missed or wrong clock-in/out. HR approves before the record changes.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { date?: unknown; clock_in?: unknown; clock_out?: unknown; reason?: unknown };
    const today = todayLagos();
    const fields: Record<string, string> = {};

    if (!isDate(body.date)) fields.date = "date must be YYYY-MM-DD";
    else if (body.date > today) fields.date = "date cannot be in the future";
    else if (body.date < addDays(today, -MAX_DAYS_BACK)) fields.date = `corrections can be requested for the last ${MAX_DAYS_BACK} days only`;

    const clockIn = body.clock_in === undefined || body.clock_in === "" ? null : normaliseTime(body.clock_in);
    const clockOut = body.clock_out === undefined || body.clock_out === "" ? null : normaliseTime(body.clock_out);
    if (body.clock_in && !clockIn) fields.clock_in = "clock_in must be HH:MM";
    if (body.clock_out && !clockOut) fields.clock_out = "clock_out must be HH:MM";
    if (!clockIn && !clockOut && !fields.clock_in && !fields.clock_out) fields.clock_in = "give clock_in, clock_out or both";
    if (clockIn && clockOut && clockOut <= clockIn) fields.clock_out = "clock_out must be after clock_in";

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 5) fields.reason = "explain the correction in at least 5 characters";

    if (Object.keys(fields).length > 0) {
      return withCors(req, { success: false, error: "Some values are not valid", fields }, 400);
    }

    let created;
    try {
      [created] = await db.transaction([
        db`
          INSERT INTO attendance_corrections (employee_id, attendance_date, requested_clock_in, requested_clock_out, reason)
          VALUES (${employee.id}, ${body.date as string}, ${clockIn}, ${clockOut}, ${reason.slice(0, 1000)})
          RETURNING id, attendance_date::text AS attendance_date, requested_clock_in::text AS requested_clock_in,
                    requested_clock_out::text AS requested_clock_out, reason, status, created_at
        `,
        employeeAuditStatement(req, employee, "employee.attendance.correction_requested", { date: body.date }),
      ]);
    } catch (error: any) {
      if (error?.code === "23505") {
        return withCors(req, { success: false, error: "You already have a pending correction for that day" }, 409);
      }
      throw error;
    }

    return withCors(req, { success: true, message: "Correction sent to HR for approval", data: created?.[0] }, 201);
  } catch (error) {
    console.error("ATTENDANCE CORRECTION ERROR:", error);
    return withCors(req, { success: false, error: "Failed to submit the correction" }, 500);
  }
}

// ?id=  Cancels the employee's own pending correction
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return withCors(req, { success: false, error: "id is required" }, 400);
    }

    const rows = await db`
      UPDATE attendance_corrections SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND employee_id = ${auth.ctx.employee.id} AND status = 'pending'
      RETURNING id
    `;
    if (!rows[0]) {
      return withCors(req, { success: false, error: "No pending correction with that id" }, 404);
    }
    return withCors(req, { success: true, message: "Correction request cancelled" });
  } catch (error) {
    console.error("ATTENDANCE CORRECTION CANCEL ERROR:", error);
    return withCors(req, { success: false, error: "Failed to cancel the correction" }, 500);
  }
}
