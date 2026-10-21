import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { ownTask } from "@/lib/employee-tasks";
import { fileProblem, storeFile } from "@/lib/employee-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// multipart/form-data: file, task_id, note?
// Uploads work for review on one of the employee's own tasks.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return withCors(req, { success: false, error: "Send the file as multipart/form-data" }, 400);
    }

    const taskId = Number(form.get("task_id"));
    if (!Number.isInteger(taskId)) return withCors(req, { success: false, error: "task_id is required" }, 400);
    const file = form.get("file");
    const problem = fileProblem(file);
    if (problem) return withCors(req, { success: false, error: problem }, 400);
    const noteRaw = form.get("note");
    const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 1000) : null;

    if (!(await ownTask(employee.id, taskId))) {
      return withCors(req, { success: false, error: "Task not found" }, 404);
    }

    const stored = await storeFile(file as File, `employee-portal/${employee.id}/tasks/${taskId}`);

    const [created] = await db.transaction([
      db`
        INSERT INTO task_deliverables (task_id, employee_id, file_url, file_name, content_type, size_bytes, note)
        VALUES (${taskId}, ${employee.id}, ${stored.url}, ${stored.fileName}, ${stored.contentType}, ${stored.sizeBytes}, ${note})
        RETURNING id, task_id, file_name, file_url, content_type, size_bytes, note, status, created_at
      `,
      employeeAuditStatement(req, employee, "employee.task.deliverable_uploaded", { task_id: taskId, file: stored.fileName }),
    ]);

    return withCors(req, { success: true, message: "Deliverable uploaded for review", data: created?.[0] }, 201);
  } catch (error) {
    console.error("EMPLOYEE DELIVERABLE UPLOAD ERROR:", error);
    return withCors(req, { success: false, error: "Failed to upload the deliverable" }, 500);
  }
}
