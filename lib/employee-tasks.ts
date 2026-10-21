import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export const CLOSED = ["completed", "done", "cancelled"];

/** Statuses an employee may set on their own task, keyed by what they may send. */
export const EMPLOYEE_STATUSES: Record<string, string> = {
  pending: "pending",
  in_progress: "in progress",
  "in progress": "in progress",
  on_hold: "on hold",
  "on hold": "on hold",
  completed: "completed",
};

/** The task if it is assigned to this employee, otherwise null. */
export async function ownTask(employeeId: string, taskId: number) {
  const rows = await sql`
    SELECT t.id, t.task_code, t.name, t.status, t.progress, t.priority, t.due_date::date::text AS due_date,
           t.project_id, p.name AS project_name, p.project_code
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ${taskId} AND t.assigned_to = ${employeeId}
  `;
  return rows[0] ?? null;
}

/** Tasks this one waits on, with whether each is finished. */
export async function dependenciesOf(taskIds: number[]) {
  if (taskIds.length === 0) return [];
  try {
    return await sql`
      SELECT d.task_id, t.id AS depends_on_task_id, t.task_code, t.name, t.status,
             LOWER(COALESCE(t.status, '')) = ANY(${CLOSED}) AS done
      FROM task_dependencies d
      JOIN tasks t ON t.id = d.depends_on_task_id
      WHERE d.task_id = ANY(${taskIds})
    `;
  } catch (error) {
    console.error("TASK DEPENDENCIES:", error);
    return [];
  }
}
