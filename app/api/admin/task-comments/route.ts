import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?task_id=  The conversation on a task
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.view");
    if (!auth.ok) return auth.response;

    const taskId = Number(new URL(req.url).searchParams.get("task_id"));
    if (!Number.isInteger(taskId)) return withCors(req, { success: false, error: "task_id is required" }, 400);

    const rows = await db`
      SELECT id, author_type, author_name, comment, created_at FROM task_comments
      WHERE task_id = ${taskId} ORDER BY created_at ASC
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST TASK COMMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch comments" }, 500);
  }
}

// Body: { task_id, comment }  The assignee is notified
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { task_id?: unknown; comment?: unknown };
    const taskId = Number(body.task_id);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!Number.isInteger(taskId)) return withCors(req, { success: false, error: "task_id is required" }, 400);
    if (comment.length < 1 || comment.length > 2000) return withCors(req, { success: false, error: "comment must be 1 to 2000 characters" }, 400);

    const task = await db`SELECT id, name, assigned_to FROM tasks WHERE id = ${taskId}`;
    if (!task[0]) return withCors(req, { success: false, error: "Task not found" }, 404);

    const rows = await db`
      INSERT INTO task_comments (task_id, author_type, author_id, author_name, comment)
      VALUES (${taskId}, 'admin', ${auth.ctx.userId}, ${auth.ctx.user.fullName || auth.ctx.user.username}, ${comment})
      RETURNING id, author_type, author_name, comment, created_at
    `;

    if (task[0].assigned_to) {
      await notify(String(task[0].assigned_to), "task", {
        title: "New comment on your task",
        message: `${auth.ctx.user.fullName || auth.ctx.user.username} commented on "${task[0].name}".`,
        link: `/employee/tasks/${taskId}`,
      });
    }
    return withCors(req, { success: true, data: rows[0] }, 201);
  } catch (error) {
    console.error("ADD TASK COMMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to add the comment" }, 500);
  }
}
