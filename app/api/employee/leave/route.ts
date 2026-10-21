import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { todayLagos, isDate, addDays, dateText } from "@/lib/employee-time";
import { leaveTypes, leaveBalances, holidayDates, workingDays, matchesType } from "@/lib/employee-leave";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// How far ahead leave can be booked
const MAX_DAYS_AHEAD = 365;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=pending|approved|rejected|cancelled  The employee's leave requests, newest first
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const status = new URL(req.url).searchParams.get("status")?.toLowerCase() || null;
    const [rows, types] = await Promise.all([
      db`
        SELECT id, leave_type, from_date::date::text AS from_date, to_date::date::text AS to_date, reason, LOWER(status) AS status
        FROM leaves
        WHERE employee_code = ${employee.id}
          AND (${status}::text IS NULL OR LOWER(status) = ${status})
        ORDER BY from_date DESC
        LIMIT 200
      `,
      leaveTypes(false),
    ]);

    const from = rows.reduce((m: string, r: any) => (r.from_date < m ? r.from_date : m), todayLagos());
    const to = rows.reduce((m: string, r: any) => (r.to_date > m ? r.to_date : m), todayLagos());
    const holidays = await holidayDates(from, to);
    const today = todayLagos();

    return withCors(req, {
      success: true,
      data: rows.map((r: any) => {
        const type = types.find((t) => matchesType(r.leave_type, t));
        return {
          ...r,
          leaveTypeName: type?.name ?? r.leave_type,
          workingDays: workingDays(String(dateText(r.from_date)), String(dateText(r.to_date)), holidays),
          canCancel: r.status === "pending" || (r.status === "approved" && r.from_date > today),
        };
      }),
    });
  } catch (error) {
    console.error("EMPLOYEE LEAVE LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your leave requests" }, 500);
  }
}

// Body: { leave_type: code, from_date, to_date, reason }
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { leave_type?: unknown; from_date?: unknown; to_date?: unknown; reason?: unknown };
    const today = todayLagos();
    const fields: Record<string, string> = {};

    const types = await leaveTypes(true);
    const code = typeof body.leave_type === "string" ? body.leave_type.trim().toLowerCase() : "";
    const type = types.find((t) => t.code === code);
    if (!type) fields.leave_type = `leave_type must be one of: ${types.map((t) => t.code).join(", ")}`;

    if (!isDate(body.from_date)) fields.from_date = "from_date must be YYYY-MM-DD";
    else if (body.from_date < today) fields.from_date = "from_date cannot be in the past";
    if (!isDate(body.to_date)) fields.to_date = "to_date must be YYYY-MM-DD";
    else if (isDate(body.from_date) && body.to_date < body.from_date) fields.to_date = "to_date must be on or after from_date";
    else if (body.to_date > addDays(today, MAX_DAYS_AHEAD)) fields.to_date = `leave can be booked up to ${MAX_DAYS_AHEAD} days ahead`;
    else if (isDate(body.from_date) && body.from_date.slice(0, 4) !== body.to_date.slice(0, 4)) {
      fields.to_date = "a request cannot run into the next year; split it into two requests";
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) fields.reason = "give a reason";

    if (Object.keys(fields).length > 0) {
      return withCors(req, { success: false, error: "Some values are not valid", fields }, 400);
    }
    const from = body.from_date as string;
    const to = body.to_date as string;

    const days = workingDays(from, to, await holidayDates(from, to));
    if (days === 0) {
      return withCors(req, { success: false, error: "Those dates are all weekends or public holidays" }, 400);
    }

    const overlap = await db`
      SELECT id FROM leaves
      WHERE employee_code = ${employee.id}
        AND LOWER(status) IN ('pending', 'approved')
        AND from_date::date <= ${to}::date AND to_date::date >= ${from}::date
      LIMIT 1
    `;
    if (overlap[0]) {
      return withCors(req, { success: false, error: "You already have leave booked or requested on some of these days" }, 409);
    }

    const balance = (await leaveBalances(employee.id, Number(from.slice(0, 4)))).find((b) => b.code === type!.code);
    if (balance && days > balance.available) {
      return withCors(req, {
        success: false,
        error: `Not enough ${type!.name.toLowerCase()}: ${days} working days requested, ${Math.max(0, balance.available)} available`,
        balance,
      }, 400);
    }

    const [created] = await db.transaction([
      db`
        INSERT INTO leaves (employee_code, employee_name, department, leave_type, from_date, to_date, reason, status)
        VALUES (${employee.id}, ${employee.name}, ${employee.department}, ${type!.code}, ${from}, ${to}, ${reason.slice(0, 1000)}, 'pending')
        RETURNING id, leave_type, from_date::date::text AS from_date, to_date::date::text AS to_date, status
      `,
      employeeAuditStatement(req, employee, "employee.leave.requested", { leave_type: type!.code, from, to, working_days: days }),
    ]);

    return withCors(req, {
      success: true,
      message: `Leave request sent for approval (${days} working day${days === 1 ? "" : "s"})`,
      data: { ...created?.[0], workingDays: days },
    }, 201);
  } catch (error) {
    console.error("EMPLOYEE LEAVE REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to submit the leave request" }, 500);
  }
}

// ?id=  Cancels a pending request, or approved leave that has not started yet
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return withCors(req, { success: false, error: "id is required" }, 400);
    }

    const rows = await db`
      SELECT id, LOWER(status) AS status, from_date::date::text AS from_date
      FROM leaves WHERE id = ${id} AND employee_code = ${employee.id}
    `;
    const leave = rows[0];
    if (!leave) return withCors(req, { success: false, error: "Leave request not found" }, 404);

    const today = todayLagos();
    const eligible = leave.status === "pending" || (leave.status === "approved" && leave.from_date > today);
    if (!eligible) {
      return withCors(req, {
        success: false,
        error: leave.status === "approved" ? "Leave that has started cannot be cancelled here. Contact HR." : `This request is already ${leave.status}`,
      }, 409);
    }

    try {
      await db`
        UPDATE leaves SET status = 'cancelled'
        WHERE id = ${id} AND employee_code = ${employee.id} AND LOWER(status) = ${leave.status}
      `;
    } catch (error: any) {
      // The leaves table may restrict status to pending/approved/rejected; then the request is removed
      if (error?.code !== "23514") throw error;
      await db`DELETE FROM leaves WHERE id = ${id} AND employee_code = ${employee.id} AND LOWER(status) = ${leave.status}`;
    }
    await employeeAuditStatement(req, employee, "employee.leave.cancelled", { leave_id: id, was: leave.status });

    return withCors(req, { success: true, message: "Leave request cancelled" });
  } catch (error) {
    console.error("EMPLOYEE LEAVE CANCEL ERROR:", error);
    return withCors(req, { success: false, error: "Failed to cancel the leave request" }, 500);
  }
}
