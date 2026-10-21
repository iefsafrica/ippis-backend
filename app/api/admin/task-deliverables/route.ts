import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=submitted (default) | approved | rejected | all   ?task_id=
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "submitted";
    const taskId = searchParams.get("task_id") ? Number(searchParams.get("task_id")) : null;
    if (!["submitted", "approved", "rejected", "all"].includes(status)) {
      return withCors(req, { success: false, error: "status must be submitted, approved, rejected or all" }, 400);
    }
    const filter = status === "all" ? null : status;

    const rows = await db`
      SELECT d.id, d.task_id, t.name AS task_name, d.employee_id, e.name AS employee_name, d.file_name, d.file_url,
             d.content_type, d.size_bytes, d.note, d.status, d.reviewed_by, d.reviewed_at, d.review_note, d.created_at
      FROM task_deliverables d
      JOIN employees e ON e.id = d.employee_id
      LEFT JOIN tasks t ON t.id = d.task_id
      WHERE (${filter}::text IS NULL OR d.status = ${filter})
        AND (${taskId}::int IS NULL OR d.task_id = ${taskId})
      ORDER BY d.created_at ASC
      LIMIT 200
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST TASK DELIVERABLES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch deliverables" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject", note? }  (note required to reject)
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.approve");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const note = readReason(body.note);
    if (!Number.isInteger(id) || id <= 0 || (body.decision !== "approve" && body.decision !== "reject")) {
      return withCors(req, { success: false, error: "id and decision (approve or reject) are required" }, 400);
    }
    if (body.decision === "reject" && !note) {
      return withCors(req, { success: false, error: "A note is required when rejecting" }, 400);
    }
    const outcome = body.decision === "approve" ? "approved" : "rejected";

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: `projects.deliverable.${outcome}`, targetType: "task_deliverable", targetId: id, reason: note, details: {} },
      [db`
        UPDATE task_deliverables
        SET status = ${outcome}, reviewed_by = ${auth.ctx.user.username}, reviewed_at = NOW(), review_note = ${note}
        WHERE id = ${id} AND status = 'submitted'
        RETURNING employee_id, task_id, file_name
      `]
    );
    const deliverable = updated?.[0];
    if (!deliverable) return withCors(req, { success: false, error: "Deliverable not found or already reviewed" }, 409);

    await notify(String(deliverable.employee_id), "task", {
      title: `Deliverable ${outcome}`,
      message: `"${deliverable.file_name}" was ${outcome}${note ? `: ${note}` : "."}`,
      link: `/employee/tasks/${deliverable.task_id}`,
    });

    return withCors(req, { success: true, message: `Deliverable ${outcome}` });
  } catch (error) {
    console.error("REVIEW TASK DELIVERABLE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to review the deliverable" }, 500);
  }
}
