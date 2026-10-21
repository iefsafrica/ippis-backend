import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { leaveBalances } from "@/lib/employee-leave";
import { syncReminders, unreadCounts } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// Working days are counted in Nigerian time
const TIME_ZONE = "Africa/Lagos";
const DEADLINE_WINDOW_DAYS = 7;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * Runs one dashboard section. A section whose table is missing or whose query
 * fails comes back as unavailable instead of failing the whole dashboard.
 */
async function section<T>(name: string, load: () => Promise<T>): Promise<{ available: true; data: T } | { available: false }> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    console.error(`EMPLOYEE DASHBOARD ${name}:`, error);
    return { available: false };
  }
}

// Everything on the employee's home screen, limited to their own records
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    // Deadline, document and training reminders are created on first view
    await syncReminders(employee.id).catch((error) => console.error("EMPLOYEE DASHBOARD reminders:", error));

    const [attendance, leave, tasks, payslip, announcements, notifications] = await Promise.all([
      section("attendance", async () => {
        const rows = await db`
          SELECT attendance_date::text AS date, clock_in, clock_out, status
          FROM attendance
          WHERE employee_code = ${employee.id}
            AND attendance_date::text = to_char(NOW() AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD')
          ORDER BY clock_in DESC NULLS LAST
          LIMIT 1
        `;
        const today = rows[0];
        return today
          ? { recorded: true, date: today.date, clockIn: today.clock_in, clockOut: today.clock_out, status: today.status }
          : { recorded: false, status: "not clocked in" };
      }),

      section("leave", async () => {
        const rows = await db`
          SELECT
            COUNT(*) FILTER (WHERE LOWER(status) = 'pending')::int AS pending_requests,
            COALESCE(SUM((to_date::date - from_date::date) + 1) FILTER (
              WHERE LOWER(status) = 'approved'
                AND EXTRACT(YEAR FROM from_date::date) = EXTRACT(YEAR FROM NOW() AT TIME ZONE ${TIME_ZONE})
            ), 0)::int AS days_taken_this_year
          FROM leaves
          WHERE employee_code = ${employee.id}
        `;
        const pending = await db`
          SELECT leave_type, from_date::text AS from_date, to_date::text AS to_date,
                 (to_date::date - from_date::date) + 1 AS days
          FROM leaves
          WHERE employee_code = ${employee.id} AND LOWER(status) = 'pending'
          ORDER BY from_date ASC
          LIMIT 5
        `;
        const balances = await leaveBalances(employee.id, Number(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric" }).format(new Date())));
        return {
          pendingRequests: rows[0]?.pending_requests ?? 0,
          daysTakenThisYear: rows[0]?.days_taken_this_year ?? 0,
          // Annual leave first; working days, not counting weekends and public holidays
          balance: balances.find((b) => b.code === "annual") ?? null,
          balances,
          pending,
        };
      }),

      section("tasks", async () => {
        const counts = await db`
          SELECT
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'cancelled'))::int AS open,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'cancelled')
                AND due_date::date < (NOW() AT TIME ZONE ${TIME_ZONE})::date
            )::int AS overdue
          FROM tasks
          WHERE assigned_to = ${employee.id}
        `;
        const upcoming = await db`
          SELECT t.task_code, t.name, t.status, t.priority, t.progress, t.due_date::text AS due_date,
                 p.name AS project_name
          FROM tasks t
          LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.assigned_to = ${employee.id}
            AND LOWER(COALESCE(t.status, '')) NOT IN ('completed', 'done', 'cancelled')
            AND t.due_date IS NOT NULL
            AND t.due_date::date <= (NOW() AT TIME ZONE ${TIME_ZONE})::date + ${DEADLINE_WINDOW_DAYS}::int
          ORDER BY t.due_date ASC
          LIMIT 5
        `;
        return { open: counts[0]?.open ?? 0, overdue: counts[0]?.overdue ?? 0, dueSoon: upcoming };
      }),

      section("payslip", async () => {
        const rows = await db`
          SELECT payment_id, payment_date, payment_type, amount, status
          FROM payroll
          WHERE employee_id = ${employee.id}
          ORDER BY payment_date DESC NULLS LAST
          LIMIT 1
        `;
        const latest = rows[0];
        return latest
          ? {
              paymentId: latest.payment_id,
              paymentDate: latest.payment_date,
              type: latest.payment_type,
              amount: latest.amount == null ? null : Number(latest.amount),
              status: latest.status,
            }
          : null;
      }),

      section("announcements", async () => {
        return db`
          SELECT id, title, content, publish_date, expiry_date
          FROM announcements
          WHERE LOWER(COALESCE(status, '')) = 'published'
            AND LOWER(COALESCE(audience, 'all')) IN ('all', 'employees', 'employee', 'staff', 'all staff')
            AND (publish_date IS NULL OR publish_date <= NOW())
            AND (expiry_date IS NULL OR expiry_date >= NOW())
          ORDER BY COALESCE(publish_date, created_at) DESC
          LIMIT 5
        `;
      }),

      section("notifications", async () => {
        const recent = await db`
          SELECT id, category, title, message, link, is_read, created_at
          FROM employee_notifications
          WHERE employee_id = ${employee.id}
          ORDER BY created_at DESC, id DESC
          LIMIT 5
        `;
        return { unread: await unreadCounts(employee.id), recent };
      }),
    ]);

    return withCors(req, {
      success: true,
      data: {
        welcome: {
          name: employee.name,
          employeeId: employee.id,
          department: employee.department,
          position: employee.position,
          startDate: employee.joinDate,
        },
        attendanceToday: attendance,
        leave,
        tasks,
        latestPayslip: payslip,
        announcements,
        notifications,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE DASHBOARD ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your dashboard" }, 500);
  }
}
