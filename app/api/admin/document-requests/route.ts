import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";
import { isDate, todayLagos } from "@/lib/employee-time";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=open|submitted|fulfilled|cancelled|all (default open and submitted)  ?employee_id=
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const employeeId = searchParams.get("employee_id");
    const all = ["open", "submitted", "fulfilled", "cancelled"];
    if (status && status !== "all" && !all.includes(status)) {
      return withCors(req, { success: false, error: "status must be open, submitted, fulfilled, cancelled or all" }, 400);
    }
    const statuses = !status ? ["open", "submitted"] : status === "all" ? all : [status];
    const sc = recordScope(auth.ctx, "employees.documents.view");

    const rows = await db`
      SELECT r.id, r.employee_id, e.name AS employee_name, r.title, r.description, r.category,
             r.due_date::text AS due_date, r.status, r.requested_by, r.created_at
      FROM document_requests r JOIN employees e ON e.id = r.employee_id
      WHERE r.status = ANY(${statuses})
        AND (${employeeId}::text IS NULL OR r.employee_id = ${employeeId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY r.due_date ASC NULLS LAST, r.created_at ASC
      LIMIT 300
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST DOCUMENT REQUESTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch document requests" }, 500);
  }
}

// Body: { employee_id, title, description?, category?, due_date? }
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.verify");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { employee_id?: unknown; title?: unknown; description?: unknown; category?: unknown; due_date?: unknown };
    const employeeId = typeof body.employee_id === "string" ? body.employee_id.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : null;
    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().toLowerCase().slice(0, 30) : "other";
    const due = body.due_date ?? null;

    if (!employeeId) return withCors(req, { success: false, error: "employee_id is required" }, 400);
    if (title.length < 2 || title.length > 255) return withCors(req, { success: false, error: "title must be 2 to 255 characters" }, 400);
    if (due !== null && (!isDate(due) || due < todayLagos())) {
      return withCors(req, { success: false, error: "due_date must be today or later, YYYY-MM-DD" }, 400);
    }
    if (!(await employeeInScope(auth.ctx, "employees.documents.verify", employeeId))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const [created] = await runAudited(
      req,
      auth.ctx,
      { action: "employees.document_request.created", targetType: "employee", targetId: employeeId, details: { title, due_date: due } },
      [db`
        INSERT INTO document_requests (employee_id, title, description, category, due_date, requested_by)
        VALUES (${employeeId}, ${title}, ${description}, ${category}, ${due as string | null}, ${auth.ctx.user.username})
        RETURNING id, employee_id, title, description, category, due_date::text AS due_date, status, created_at
      `]
    );
    const request = created?.[0];

    await notify(employeeId, "document", {
      title: "Document requested",
      message: due ? `HR needs "${title}" by ${due}.` : `HR needs "${title}".`,
      link: "/employee/documents",
      dedupeKey: `doc-request:${request?.id}`,
    });
    return withCors(req, { success: true, message: "Request sent to the employee", data: request }, 201);
  } catch (error) {
    console.error("CREATE DOCUMENT REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to create the request" }, 500);
  }
}

// ?id=&reason=  Withdraws a request that has not been fulfilled
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.verify");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return withCors(req, { success: false, error: "id is required" }, 400);
    const [owner] = await db`SELECT employee_id FROM document_requests WHERE id = ${id}`;
    if (!owner || !(await employeeInScope(auth.ctx, "employees.documents.verify", owner.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: "employees.document_request.cancelled", targetType: "document_request", targetId: id, reason: readReason(searchParams.get("reason")), details: {} },
      [db`
        UPDATE document_requests SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id} AND status IN ('open', 'submitted')
        RETURNING id
      `]
    );
    if (!updated?.[0]) return withCors(req, { success: false, error: "Request not found or already closed" }, 404);
    return withCors(req, { success: true, message: "Request cancelled" });
  } catch (error) {
    console.error("CANCEL DOCUMENT REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to cancel the request" }, 500);
  }
}
