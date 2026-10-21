import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?task_id=  What a task waits on
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.view");
    if (!auth.ok) return auth.response;

    const taskId = Number(new URL(req.url).searchParams.get("task_id"));
    if (!Number.isInteger(taskId)) return withCors(req, { success: false, error: "task_id is required" }, 400);

    const rows = await db`
      SELECT d.depends_on_task_id, t.task_code, t.name, t.status, d.created_by, d.created_at
      FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id
      WHERE d.task_id = ${taskId}
      ORDER BY t.name
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST TASK DEPENDENCIES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch dependencies" }, 500);
  }
}

// Body: { task_id, depends_on_task_id }  task_id cannot be completed until the other task is
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { task_id?: unknown; depends_on_task_id?: unknown };
    const taskId = Number(body.task_id);
    const dependsOn = Number(body.depends_on_task_id);
    if (!Number.isInteger(taskId) || !Number.isInteger(dependsOn) || taskId === dependsOn) {
      return withCors(req, { success: false, error: "task_id and a different depends_on_task_id are required" }, 400);
    }

    const found = await db`SELECT id FROM tasks WHERE id = ANY(${[taskId, dependsOn]})`;
    if (found.length !== 2) return withCors(req, { success: false, error: "Both tasks must exist" }, 404);

    // Refuse a loop: dependsOn must not already (directly or indirectly) wait on taskId
    const loop = await db`
      WITH RECURSIVE chain(id) AS (
        SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ${dependsOn}
        UNION
        SELECT d.depends_on_task_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
      )
      SELECT 1 FROM chain WHERE id = ${taskId} LIMIT 1
    `;
    if (loop[0]) return withCors(req, { success: false, error: "That would make the tasks wait on each other" }, 409);

    await runAudited(
      req,
      auth.ctx,
      { action: "projects.task_dependency.added", targetType: "task", targetId: taskId, details: { depends_on: dependsOn } },
      [db`
        INSERT INTO task_dependencies (task_id, depends_on_task_id, created_by)
        VALUES (${taskId}, ${dependsOn}, ${auth.ctx.user.username})
        ON CONFLICT DO NOTHING
      `]
    );
    return withCors(req, { success: true, message: "Dependency added" }, 201);
  } catch (error) {
    console.error("ADD TASK DEPENDENCY ERROR:", error);
    return withCors(req, { success: false, error: "Failed to add the dependency" }, 500);
  }
}

// ?task_id=&depends_on_task_id=
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const taskId = Number(searchParams.get("task_id"));
    const dependsOn = Number(searchParams.get("depends_on_task_id"));
    if (!Number.isInteger(taskId) || !Number.isInteger(dependsOn)) {
      return withCors(req, { success: false, error: "task_id and depends_on_task_id are required" }, 400);
    }

    const [removed] = await runAudited(
      req,
      auth.ctx,
      { action: "projects.task_dependency.removed", targetType: "task", targetId: taskId, details: { depends_on: dependsOn } },
      [db`DELETE FROM task_dependencies WHERE task_id = ${taskId} AND depends_on_task_id = ${dependsOn} RETURNING task_id`]
    );
    if (!removed?.[0]) return withCors(req, { success: false, error: "Dependency not found" }, 404);
    return withCors(req, { success: true, message: "Dependency removed" });
  } catch (error) {
    console.error("REMOVE TASK DEPENDENCY ERROR:", error);
    return withCors(req, { success: false, error: "Failed to remove the dependency" }, 500);
  }
}
