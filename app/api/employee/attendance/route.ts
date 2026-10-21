import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { todayLagos, isDate, addDays, mondayOf, eachDate, isoWeekday, minutesBetween, dateText } from "@/lib/employee-time";
import { shiftFor, shiftMinutes } from "@/lib/employee-attendance";
import { holidayDates } from "@/lib/employee-leave";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

function range(period: string, date: string): [string, string] {
  if (period === "day") return [date, date];
  if (period === "week") {
    const start = mondayOf(date);
    return [start, addDays(start, 6)];
  }
  const start = `${date.slice(0, 7)}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [start, addDays(next.toISOString().slice(0, 10), -1)];
}

// ?period=day|week|month (default month)  ?date=YYYY-MM-DD (default today)
// Each working day up to today with what happened, plus totals for lateness,
// absences and overtime.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "month";
    const today = todayLagos();
    const date = searchParams.get("date") || today;
    if (!["day", "week", "month"].includes(period)) {
      return withCors(req, { success: false, error: "period must be day, week or month" }, 400);
    }
    if (!isDate(date)) {
      return withCors(req, { success: false, error: "date must be YYYY-MM-DD" }, 400);
    }

    const [from, to] = range(period, date);
    const [records, leaves, holidays, shift] = await Promise.all([
      db`
        SELECT attendance_date::text AS date, clock_in::text AS clock_in, clock_out::text AS clock_out,
               LOWER(COALESCE(status, '')) AS status, notes
        FROM attendance
        WHERE employee_code = ${employee.id}
          AND attendance_date::text BETWEEN ${from} AND ${to}
        ORDER BY attendance_date ASC
      `,
      db`
        SELECT from_date::date::text AS from_date, to_date::date::text AS to_date, leave_type
        FROM leaves
        WHERE employee_code = ${employee.id} AND LOWER(status) = 'approved'
          AND from_date::date <= ${to}::date AND to_date::date >= ${from}::date
      `,
      holidayDates(from, to),
      shiftFor(employee.department),
    ]);

    const byDate = new Map(records.map((r: any) => [String(r.date).slice(0, 10), r]));
    const onLeave = (d: string) => leaves.find((l: any) => String(dateText(l.from_date)) <= d && d <= String(dateText(l.to_date)));
    const expected = shiftMinutes(shift);
    const startedOn = employee.joinDate ?? from;

    const days = [];
    const totals = { present: 0, late: 0, absent: 0, onLeave: 0, holidays: 0, hoursWorked: 0, overtimeHours: 0 };
    let workedMinutes = 0;
    let overtimeMinutes = 0;

    for (const d of eachDate(from, to)) {
      if (d > today) break;
      const record = byDate.get(d);
      const weekend = isoWeekday(d) > 5;
      let status: string;

      if (record) {
        status = record.status || (record.clock_in ? "present" : "absent");
      } else if (holidays.has(d)) {
        status = "holiday";
      } else if (onLeave(d)) {
        status = "leave";
      } else if (weekend || d < startedOn) {
        continue;
      } else {
        // A working day with no record and no leave counts as an absence
        status = d === today ? "not clocked in" : "absent";
      }

      const clockIn = record?.clock_in ? String(record.clock_in).slice(0, 8) : null;
      const clockOut = record?.clock_out ? String(record.clock_out).slice(0, 8) : null;
      const worked = minutesBetween(clockIn, clockOut);
      // Weekend and holiday work is all overtime
      const overtime = worked > 0 ? (weekend || holidays.has(d) ? worked : Math.max(0, worked - expected)) : 0;
      workedMinutes += worked;
      overtimeMinutes += overtime;

      if (status === "present") totals.present++;
      else if (status === "late") { totals.present++; totals.late++; }
      else if (status === "absent") totals.absent++;
      else if (status === "leave") totals.onLeave++;
      else if (status === "holiday") totals.holidays++;

      days.push({
        date: d,
        status,
        clockIn,
        clockOut,
        hoursWorked: hours(worked),
        overtimeHours: hours(overtime),
        leaveType: status === "leave" ? onLeave(d)?.leave_type ?? null : null,
        notes: record?.notes ?? null,
      });
    }
    totals.hoursWorked = hours(workedMinutes);
    totals.overtimeHours = hours(overtimeMinutes);

    return withCors(req, {
      success: true,
      data: {
        period,
        from,
        to,
        shift: { name: shift.name, start: shift.start, end: shift.end, lateAfter: shift.lateAfter, hoursPerDay: hours(expected) },
        totals,
        days,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE ATTENDANCE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your attendance" }, 500);
  }
}
