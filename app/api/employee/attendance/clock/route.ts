import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { todayLagos, nowTimeLagos, minutesBetween } from "@/lib/employee-time";
import { shiftFor, arrivalStatus } from "@/lib/employee-attendance";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { action: "in" | "out", note? }
// The time is taken from the server clock in Lagos time, never from the request.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
    if (body.action !== "in" && body.action !== "out") {
      return withCors(req, { success: false, error: "action must be \"in\" or \"out\"" }, 400);
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    const today = todayLagos();
    const now = nowTimeLagos();
    const rows = await db`
      SELECT id, clock_in::text AS clock_in, clock_out::text AS clock_out, status
      FROM attendance
      WHERE employee_code = ${employee.id} AND attendance_date::text = ${today}
      ORDER BY id DESC
      LIMIT 1
    `;
    const record = rows[0];

    if (body.action === "in") {
      if (record?.clock_in) {
        return withCors(req, { success: false, error: `You already clocked in today at ${String(record.clock_in).slice(0, 5)}` }, 409);
      }
      const shift = await shiftFor(employee.department);
      const status = arrivalStatus(now, shift);

      const saved = record
        ? await db`
            UPDATE attendance SET clock_in = ${now}, status = ${status}, notes = COALESCE(${note}, notes)
            WHERE id = ${record.id}
            RETURNING attendance_date::text AS date, clock_in::text AS clock_in, status
          `
        : await db`
            INSERT INTO attendance (employee_code, employee_name, department, attendance_date, clock_in, status, notes)
            VALUES (${employee.id}, ${employee.name}, ${employee.department}, ${today}, ${now}, ${status}, ${note})
            RETURNING attendance_date::text AS date, clock_in::text AS clock_in, status
          `;

      return withCors(req, {
        success: true,
        message: status === "late" ? `Clocked in at ${now.slice(0, 5)} (after ${shift.lateAfter.slice(0, 5)}, marked late)` : `Clocked in at ${now.slice(0, 5)}`,
        data: { ...saved[0], shift: shift.name },
      }, 201);
    }

    if (!record?.clock_in) {
      return withCors(req, { success: false, error: "You have not clocked in today" }, 409);
    }
    if (record.clock_out) {
      return withCors(req, { success: false, error: `You already clocked out today at ${String(record.clock_out).slice(0, 5)}` }, 409);
    }

    const saved = await db`
      UPDATE attendance SET clock_out = ${now}, notes = COALESCE(${note}, notes)
      WHERE id = ${record.id}
      RETURNING attendance_date::text AS date, clock_in::text AS clock_in, clock_out::text AS clock_out, status
    `;
    const worked = minutesBetween(String(record.clock_in).slice(0, 8), now);

    return withCors(req, {
      success: true,
      message: `Clocked out at ${now.slice(0, 5)}`,
      data: { ...saved[0], hoursWorked: Math.round((worked / 60) * 100) / 100 },
    });
  } catch (error) {
    console.error("EMPLOYEE CLOCK ERROR:", error);
    return withCors(req, { success: false, error: "Failed to record your attendance" }, 500);
  }
}
