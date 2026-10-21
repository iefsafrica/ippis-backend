import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { todayLagos, addDays } from "@/lib/employee-time";
import { CLOSED, EMPLOYEE_STATUSES, ownTask, dependenciesOf } from "@/lib/employee-tasks";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function deadline(due: string | null, status: string, today: string) {
  if (!due || CLOSED.includes(status)) return null;
  if (due < today) return "overdue";
  if (due <= addDays(today, 2)) return "due soon";
  return null;
}

// Without ?id: the employee's tasks (?status=open|closed|all, default open).
// With ?id: one task with its dependencies, comments and deliverables.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const { searchParams } = new URL(req.url);
    const today = todayLagos();
    const idParam = searchParams.get("id");

    if (idParam) {
      const id = Number(idParam);
      if (!Number.isInteger(id)) return withCors(req, { success: false, error: "id is not valid" }, 400);
      const task = await ownTask(employee.id, id);
      if (!task) return withCors(req, { success: false, error: "Task not found" }, 404);

      const [dependencies, comments, deliverables] = await Promise.all([
        dependenciesOf([id]),
        db`SELECT id, author_type, author_name, comment, created_at FROM task_comments WHERE task_id = ${id} ORDER BY created_at ASC`,
        db`
          SELECT id, file_name, file_url, content_type, size_bytes, note, status, review_note, reviewed_at, created_at
          FROM task_deliverables WHERE task_id = ${id} AND employee_id = ${employee.id} ORDER BY created_at DESC
        `,
      ]);
      const status = String(task.status ?? "").toLowerCase();
      return withCors(req, {
        success: true,
        data: {
          ...task,
          deadline: deadline(task.due_date, status, today),
          dependencies,
          blocked: dependencies.some((d: any) => !d.done),
          comments,
          deliverables,
        },
      });
    }

    const filter = searchParams.get("status") || "open";
    if (!["open", "closed", "all"].includes(filter)) {
      return withCors(req, { success: false, error: "status must be open, closed or all" }, 400);
    }
    const rows = await db`
      SELECT t.id, t.task_code, t.name, LOWER(COALESCE(t.status, '')) AS status, t.progress, t.priority,
             t.due_date::date::text AS due_date, p.name AS project_name, p.project_code,
             (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comments
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assigned_to = ${employee.id}
        AND (${filter} = 'all'
             OR (${filter} = 'open' AND NOT (LOWER(COALESCE(t.status, '')) = ANY(${CLOSED})))
             OR (${filter} = 'closed' AND LOWER(COALESCE(t.status, '')) = ANY(${CLOSED})))
      ORDER BY t.due_date ASC NULLS LAST, t.id
      LIMIT 300
    `;
    const deps = await dependenciesOf(rows.map((r: any) => Number(r.id)));

    // Group tasks by project for the "assigned projects" view
    const projects = new Map<string, { name: string | null; code: string | null; tasks: number; completed: number }>();
    for (const r of rows) {
      const key = String(r.project_code ?? r.project_name ?? "none");
      const p = projects.get(key) ?? { name: r.project_name ?? null, code: r.project_code ?? null, tasks: 0, completed: 0 };
      p.tasks++;
      if (CLOSED.includes(r.status)) p.completed++;
      projects.set(key, p);
    }

    return withCors(req, {
      success: true,
      data: {
        tasks: rows.map((r: any) => ({
          ...r,
          deadline: deadline(r.due_date, r.status, today),
          blocked: deps.some((d: any) => Number(d.task_id) === Number(r.id) && !d.done),
        })),
        projects: [...projects.values()],
      },
    });
  } catch (error) {
    console.error("EMPLOYEE TASKS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your tasks" }, 500);
  }
}

// Body: { id, status?, progress? (0-100) }
// Completing a task sets progress to 100; a task waiting on unfinished tasks cannot be completed.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown; progress?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return withCors(req, { success: false, error: "id is required" }, 400);
    if (body.status === undefined && body.progress === undefined) {
      return withCors(req, { success: false, error: "send status, progress or both" }, 400);
    }

    let status: string | null = null;
    if (body.status !== undefined) {
      status = typeof body.status === "string" ? EMPLOYEE_STATUSES[body.status.trim().toLowerCase()] ?? null : null;
      if (!status) {
        return withCors(req, { success: false, error: "status must be pending, in_progress, on_hold or completed" }, 400);
      }
    }
    let progress: number | null = null;
    if (body.progress !== undefined) {
      progress = Number(body.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        return withCors(req, { success: false, error: "progress must be a whole number from 0 to 100" }, 400);
      }
    }

    const task = await ownTask(employee.id, id);
    if (!task) return withCors(req, { success: false, error: "Task not found" }, 404);
    if (String(task.status ?? "").toLowerCase() === "cancelled") {
      return withCors(req, { success: false, error: "This task was cancelled" }, 409);
    }

    if (status === "completed" || progress === 100) {
      const open = (await dependenciesOf([id])).filter((d: any) => !d.done);
      if (open.length > 0) {
        return withCors(req, {
          success: false,
          error: `This task waits on: ${open.map((d: any) => d.name).join(", ")}. Finish those first.`,
        }, 409);
      }
      status = "completed";
      progress = 100;
    } else if (progress !== null && progress > 0 && !status && String(task.status ?? "").toLowerCase() === "pending") {
      // Reporting progress on a task that was not started moves it to in progress
      status = "in progress";
    }

    const [updated] = await db.transaction([
      db`
        UPDATE tasks
        SET status = COALESCE(${status}, status), progress = COALESCE(${progress}, progress)
        WHERE id = ${id} AND assigned_to = ${employee.id}
        RETURNING id, name, status, progress
      `,
      employeeAuditStatement(req, employee, "employee.task.updated", { task_id: id, status, progress }),
    ]);
    return withCors(req, { success: true, message: "Task updated", data: updated?.[0] });
  } catch (error) {
    console.error("EMPLOYEE TASK UPDATE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the task" }, 500);
  }
}
