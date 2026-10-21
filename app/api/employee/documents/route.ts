import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";
import { fileProblem, storeFile } from "@/lib/employee-files";
import { todayLagos, addDays, isDate } from "@/lib/employee-time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = neon(process.env.DATABASE_URL!);

// Categories an employee may upload; contracts and letters come from HR
const EMPLOYEE_CATEGORIES = ["certificate", "identification", "other"];

const ONBOARDING: [string, string, string][] = [
  ["appointment_letter_path", "Appointment letter", "appointment_letter"],
  ["promotion_letter_path", "Promotion letter", "hr_letter"],
  ["educational_certificates_path", "Educational certificates", "certificate"],
  ["other_documents_path", "Other onboarding documents", "other"],
];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Everything the employee can see: onboarding documents, HR-issued documents
// and forms, their own uploads with verification status, and open requests.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;
    const today = todayLagos();

    let onboarding: any[] = [];
    if (employee.registrationId) {
      try {
        const rows = await db`SELECT * FROM document_uploads WHERE registration_id = ${employee.registrationId}`;
        const r = rows[0];
        if (r) {
          onboarding = ONBOARDING.filter(([col]) => r[col]).map(([col, title, category]) => ({
            title, category, url: r[col], status: r.status ?? null, source: "onboarding",
          }));
        }
      } catch (error) {
        console.error("EMPLOYEE DOCUMENTS onboarding:", error);
      }
    }

    const [documents, requests] = await Promise.all([
      db`
        SELECT id, employee_id IS NULL AS for_everyone, category, title, file_name, file_url, content_type, size_bytes,
               source, status, request_id, expires_at::text AS expires_at, review_note, verified_at, created_at
        FROM employee_documents
        WHERE employee_id = ${employee.id} OR (employee_id IS NULL AND category = 'form')
        ORDER BY created_at DESC
      `,
      db`
        SELECT id, title, description, category, due_date::text AS due_date, status, created_at
        FROM document_requests
        WHERE employee_id = ${employee.id} AND status IN ('open', 'submitted')
        ORDER BY due_date ASC NULLS LAST
      `,
    ]);

    const withExpiry = documents.map((d: any) => ({
      ...d,
      expiry: !d.expires_at ? null : d.expires_at < today ? "expired" : d.expires_at <= addDays(today, 30) ? "expiring soon" : null,
    }));

    return withCors(req, {
      success: true,
      data: {
        onboarding,
        fromHr: withExpiry.filter((d: any) => d.source === "hr" && d.category !== "form"),
        forms: withExpiry.filter((d: any) => d.category === "form"),
        uploads: withExpiry.filter((d: any) => d.source === "employee"),
        requests,
        reminders: {
          missing: requests.filter((r: any) => r.status === "open").length,
          expiringSoon: withExpiry.filter((d: any) => d.expiry === "expiring soon").length,
          expired: withExpiry.filter((d: any) => d.expiry === "expired").length,
        },
      },
    });
  } catch (error) {
    console.error("EMPLOYEE DOCUMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your documents" }, 500);
  }
}

// multipart/form-data: file, title, category (certificate | identification | other),
// request_id? (answers an HR request), expires_at? (YYYY-MM-DD)
// HR verifies the upload before it counts.
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

    const file = form.get("file");
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "other").trim().toLowerCase();
    const requestId = form.get("request_id") ? Number(form.get("request_id")) : null;
    const expiresRaw = String(form.get("expires_at") ?? "").trim();

    const problem = fileProblem(file);
    if (problem) return withCors(req, { success: false, error: problem }, 400);
    if (title.length < 2 || title.length > 255) return withCors(req, { success: false, error: "title must be 2 to 255 characters" }, 400);
    if (!EMPLOYEE_CATEGORIES.includes(category)) {
      return withCors(req, { success: false, error: `category must be one of: ${EMPLOYEE_CATEGORIES.join(", ")}` }, 400);
    }
    if (expiresRaw && !isDate(expiresRaw)) return withCors(req, { success: false, error: "expires_at must be YYYY-MM-DD" }, 400);
    if (requestId !== null && !Number.isInteger(requestId)) return withCors(req, { success: false, error: "request_id is not valid" }, 400);

    if (requestId !== null) {
      const open = await db`SELECT id FROM document_requests WHERE id = ${requestId} AND employee_id = ${employee.id} AND status = 'open'`;
      if (!open[0]) return withCors(req, { success: false, error: "No open document request with that id" }, 404);
    }

    const stored = await storeFile(file as File, `employee-portal/${employee.id}/documents`);

    const statements = [
      db`
        INSERT INTO employee_documents (employee_id, category, title, file_url, file_name, content_type, size_bytes,
                                        source, status, request_id, expires_at, uploaded_by)
        VALUES (${employee.id}, ${category}, ${title}, ${stored.url}, ${stored.fileName}, ${stored.contentType}, ${stored.sizeBytes},
                'employee', 'pending', ${requestId}, ${expiresRaw || null}, ${employee.id})
        RETURNING id, category, title, file_name, file_url, status, request_id, expires_at::text AS expires_at, created_at
      `,
      employeeAuditStatement(req, employee, "employee.document.uploaded", { title, category, request_id: requestId }),
    ];
    if (requestId !== null) {
      statements.push(db`UPDATE document_requests SET status = 'submitted', updated_at = NOW() WHERE id = ${requestId} AND status = 'open'`);
    }
    const [created] = await db.transaction(statements);

    return withCors(req, { success: true, message: "Document uploaded; HR will verify it", data: created?.[0] }, 201);
  } catch (error) {
    console.error("EMPLOYEE DOCUMENT UPLOAD ERROR:", error);
    return withCors(req, { success: false, error: "Failed to upload the document" }, 500);
  }
}
