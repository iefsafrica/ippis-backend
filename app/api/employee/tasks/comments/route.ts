import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { ownTask } from "@/lib/employee-tasks";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { task_id, comment }  A comment on one of the employee's own tasks
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { task_id?: unknown; comment?: unknown };
    const taskId = Number(body.task_id);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!Number.isInteger(taskId)) return withCors(req, { success: false, error: "task_id is required" }, 400);
    if (comment.length < 1 || comment.length > 2000) {
      return withCors(req, { success: false, error: "comment must be 1 to 2000 characters" }, 400);
    }

    if (!(await ownTask(employee.id, taskId))) {
      return withCors(req, { success: false, error: "Task not found" }, 404);
    }

    const rows = await db`
      INSERT INTO task_comments (task_id, author_type, author_id, author_name, comment)
      VALUES (${taskId}, 'employee', ${employee.id}, ${employee.name}, ${comment})
      RETURNING id, author_type, author_name, comment, created_at
    `;
    return withCors(req, { success: true, data: rows[0] }, 201);
  } catch (error) {
    console.error("EMPLOYEE TASK COMMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to add the comment" }, 500);
  }
}
