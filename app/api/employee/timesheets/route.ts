import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { todayLagos, isDate, isoWeekday, mondayOf, addDays } from "@/lib/employee-time";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// Timesheets can be submitted for the current week and the 8 before it
const WEEKS_BACK = 8;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT id, week_start::text AS week_start, entries, total_hours, employee_note, status,
             review_note, reviewed_at, submitted_at
      FROM employee_timesheets
      WHERE employee_id = ${auth.ctx.employee.id}
      ORDER BY week_start DESC
      LIMIT 60
    `;
    return withCors(req, {
      success: true,
      data: rows.map((r: any) => ({ ...r, total_hours: Number(r.total_hours) })),
    });
  } catch (error) {
    console.error("EMPLOYEE TIMESHEETS LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your timesheets" }, 500);
  }
}

// Body: { week_start: Monday "YYYY-MM-DD", entries: [{ date, hours, note? }], note? }
// Submitting again replaces the week, unless HR has already approved it.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { week_start?: unknown; entries?: unknown; note?: unknown };
    const thisWeek = mondayOf(todayLagos());

    if (!isDate(body.week_start) || isoWeekday(body.week_start) !== 1) {
      return withCors(req, { success: false, error: "week_start must be a Monday, YYYY-MM-DD" }, 400);
    }
    const weekStart = body.week_start;
    if (weekStart > thisWeek || weekStart < addDays(thisWeek, -7 * WEEKS_BACK)) {
      return withCors(req, { success: false, error: `Timesheets can be submitted for this week and the ${WEEKS_BACK} weeks before it` }, 400);
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0 || body.entries.length > 7) {
      return withCors(req, { success: false, error: "entries must list 1 to 7 days" }, 400);
    }

    const weekEnd = addDays(weekStart, 6);
    const seen = new Set<string>();
    const entries: { date: string; hours: number; note: string | null }[] = [];
    for (const [i, raw] of (body.entries as any[]).entries()) {
      const hours = Number(raw?.hours);
      if (!isDate(raw?.date) || raw.date < weekStart || raw.date > weekEnd) {
        return withCors(req, { success: false, error: `entries[${i}].date must be a day in the week starting ${weekStart}` }, 400);
      }
      if (seen.has(raw.date)) {
        return withCors(req, { success: false, error: `${raw.date} appears more than once` }, 400);
      }
      if (!Number.isFinite(hours) || hours < 0 || hours > 24 || Math.round(hours * 4) !== hours * 4) {
        return withCors(req, { success: false, error: `entries[${i}].hours must be between 0 and 24, in quarter hours` }, 400);
      }
      seen.add(raw.date);
      entries.push({ date: raw.date, hours, note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 300) : null });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const total = entries.reduce((sum, e) => sum + e.hours, 0);
    if (total <= 0) {
      return withCors(req, { success: false, error: "The timesheet has no hours" }, 400);
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;

    const existing = await db`
      SELECT status FROM employee_timesheets WHERE employee_id = ${employee.id} AND week_start = ${weekStart}::date
    `;
    if (existing[0]?.status === "approved") {
      return withCors(req, { success: false, error: "This week's timesheet is already approved and cannot be changed" }, 409);
    }

    const [saved] = await db.transaction([
      db`
        INSERT INTO employee_timesheets (employee_id, week_start, entries, total_hours, employee_note, status, submitted_at)
        VALUES (${employee.id}, ${weekStart}, ${JSON.stringify(entries)}::jsonb, ${total}, ${note}, 'submitted', NOW())
        ON CONFLICT (employee_id, week_start) DO UPDATE SET
          entries = EXCLUDED.entries,
          total_hours = EXCLUDED.total_hours,
          employee_note = EXCLUDED.employee_note,
          status = 'submitted',
          review_note = NULL,
          reviewed_by = NULL,
          reviewed_at = NULL,
          submitted_at = NOW(),
          updated_at = NOW()
        WHERE employee_timesheets.status <> 'approved'
        RETURNING id, week_start::text AS week_start, entries, total_hours, status, submitted_at
      `,
      employeeAuditStatement(req, employee, "employee.timesheet.submitted", { week_start: weekStart, total_hours: total }),
    ]);

    const row = saved?.[0];
    if (!row) {
      return withCors(req, { success: false, error: "This week's timesheet is already approved and cannot be changed" }, 409);
    }
    return withCors(req, {
      success: true,
      message: existing[0] ? "Timesheet resubmitted for approval" : "Timesheet submitted for approval",
      data: { ...row, total_hours: Number(row.total_hours) },
    }, existing[0] ? 200 : 201);
  } catch (error) {
    console.error("EMPLOYEE TIMESHEET SUBMIT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to submit the timesheet" }, 500);
  }
}
