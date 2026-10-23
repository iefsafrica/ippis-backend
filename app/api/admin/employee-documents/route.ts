import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { fileProblem, storeFile } from "@/lib/employee-files";
import { notify } from "@/lib/employee-notifications";
import { isDate } from "@/lib/employee-time";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = neon(process.env.DATABASE_URL!);

const HR_CATEGORIES = ["contract", "appointment_letter", "hr_letter", "form", "certificate", "identification", "other"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=pending (uploads waiting for verification) | verified | rejected | issued | all
// ?employee_id=  one employee's documents
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || (searchParams.get("employee_id") ? "all" : "pending");
    const employeeId = searchParams.get("employee_id");
    if (!["pending", "verified", "rejected", "issued", "all"].includes(status)) {
      return withCors(req, { success: false, error: "status must be pending, verified, rejected, issued or all" }, 400);
    }
    const filter = status === "all" ? null : status;
    // Documents of employees inside the caller's MDA or department, and the
    // forms every employee can download
    const sc = recordScope(auth.ctx, "employees.documents.view");

    const rows = await db`
      SELECT d.id, d.employee_id, e.name AS employee_name, d.category, d.title, d.file_name, d.file_url, d.content_type,
             d.size_bytes, d.source, d.status, d.request_id, d.expires_at::text AS expires_at, d.uploaded_by,
             d.verified_by, d.verified_at, d.review_note, d.created_at
      FROM employee_documents d
      LEFT JOIN employees e ON e.id = d.employee_id
      WHERE (${filter}::text IS NULL OR d.status = ${filter})
        AND (${employeeId}::text IS NULL OR d.employee_id = ${employeeId})
        AND (d.employee_id IS NULL OR (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[])))
      ORDER BY d.created_at ASC
      LIMIT 300
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST EMPLOYEE DOCUMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch documents" }, 500);
  }
}

// multipart/form-data: file, title, category, employee_id (leave out for a form
// every employee can download), expires_at?
// Issues a contract, letter or form from HR.
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.records.update");
    if (!auth.ok) return auth.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return withCors(req, { success: false, error: "Send the file as multipart/form-data" }, 400);
    }
    const file = form.get("file");
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "").trim().toLowerCase();
    const employeeId = String(form.get("employee_id") ?? "").trim() || null;
    const expires = String(form.get("expires_at") ?? "").trim() || null;

    const problem = fileProblem(file);
    if (problem) return withCors(req, { success: false, error: problem }, 400);
    if (title.length < 2 || title.length > 255) return withCors(req, { success: false, error: "title must be 2 to 255 characters" }, 400);
    if (!HR_CATEGORIES.includes(category)) return withCors(req, { success: false, error: `category must be one of: ${HR_CATEGORIES.join(", ")}` }, 400);
    if (!employeeId && category !== "form") return withCors(req, { success: false, error: "employee_id is required unless the category is form" }, 400);
    if (expires && !isDate(expires)) return withCors(req, { success: false, error: "expires_at must be YYYY-MM-DD" }, 400);
    if (employeeId) {
      if (!(await employeeInScope(auth.ctx, "employees.records.update", employeeId))) {
        return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
      }
    } else if (!recordScope(auth.ctx, "employees.records.update").all) {
      // A form reaches every employee in every MDA
      return withCors(req, { success: false, error: "Issuing a form for all employees needs employee rights across all MDAs" }, 403);
    }

    const stored = await storeFile(file as File, employeeId ? `employee-portal/${employeeId}/hr` : "employee-portal/forms");
    const [created] = await runAudited(
      req,
      auth.ctx,
      { action: "employees.document.issued", targetType: employeeId ? "employee" : "form", targetId: employeeId ?? title, details: { title, category } },
      [db`
        INSERT INTO employee_documents (employee_id, category, title, file_url, file_name, content_type, size_bytes,
                                        source, status, expires_at, uploaded_by)
        VALUES (${employeeId}, ${category}, ${title}, ${stored.url}, ${stored.fileName}, ${stored.contentType}, ${stored.sizeBytes},
                'hr', 'issued', ${expires}, ${auth.ctx.user.username})
        RETURNING id, employee_id, category, title, file_name, file_url, status, expires_at::text AS expires_at, created_at
      `]
    );

    if (employeeId) {
      await notify(employeeId, "document", {
        title: "New document from HR",
        message: `"${title}" is available in your documents.`,
        link: "/employee/documents",
      });
    }
    return withCors(req, { success: true, message: "Document issued", data: created?.[0] }, 201);
  } catch (error) {
    console.error("ISSUE EMPLOYEE DOCUMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to issue the document" }, 500);
  }
}

// Body: { id, decision: "verify" | "reject", note? }  (note required to reject)
// For documents employees uploaded. Verifying closes the request it answered;
// rejecting reopens it.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.documents.verify");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const note = readReason(body.note);
    if (!Number.isInteger(id) || id <= 0 || (body.decision !== "verify" && body.decision !== "reject")) {
      return withCors(req, { success: false, error: "id and decision (verify or reject) are required" }, 400);
    }
    if (body.decision === "reject" && !note) {
      return withCors(req, { success: false, error: "A note is required when rejecting, so the employee knows what to fix" }, 400);
    }
    const outcome = body.decision === "verify" ? "verified" : "rejected";

    const [owner] = await db`SELECT employee_id FROM employee_documents WHERE id = ${id}`;
    if (!owner || !(await employeeInScope(auth.ctx, "employees.documents.verify", owner.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: `employees.document.${outcome}`, targetType: "employee_document", targetId: id, reason: note, details: {} },
      [
        db`
          UPDATE employee_documents
          SET status = ${outcome}, verified_by = ${auth.ctx.user.username}, verified_at = NOW(), review_note = ${note}
          WHERE id = ${id} AND source = 'employee' AND status = 'pending'
          RETURNING employee_id, title, request_id
        `,
        db`
          UPDATE document_requests r
          SET status = ${outcome === "verified" ? "fulfilled" : "open"}, updated_at = NOW()
          FROM employee_documents d
          WHERE d.id = ${id} AND d.status = ${outcome} AND d.verified_at = NOW() AND r.id = d.request_id
        `,
      ]
    );
    const doc = updated?.[0];
    if (!doc) return withCors(req, { success: false, error: "Document not found, not an employee upload, or already reviewed" }, 409);

    await notify(String(doc.employee_id), "document", {
      title: `Document ${outcome}`,
      message: outcome === "verified" ? `"${doc.title}" has been verified.` : `"${doc.title}" was rejected: ${note}`,
      link: "/employee/documents",
    });
    return withCors(req, { success: true, message: `Document ${outcome}` });
  } catch (error) {
    console.error("VERIFY EMPLOYEE DOCUMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to review the document" }, 500);
  }
}
