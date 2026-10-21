import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const STATUSES = ["open", "in_review", "resolved", "rejected"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=open|in_review|resolved|rejected|all (default: open and in_review)   ?employee_id=
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const employeeId = searchParams.get("employee_id");
    if (status && status !== "all" && !STATUSES.includes(status)) {
      return withCors(req, { success: false, error: `status must be one of: ${[...STATUSES, "all"].join(", ")}` }, 400);
    }
    const statuses = !status ? ["open", "in_review"] : status === "all" ? STATUSES : [status];

    const rows = await db`
      SELECT d.id, d.employee_id, e.name AS employee_name, e.department, d.payment_id, d.category, d.description,
             d.expected_amount, p.amount AS paid_amount, d.status, d.hr_response, d.handled_by, d.handled_at, d.created_at
      FROM payroll_discrepancies d
      JOIN employees e ON e.id = d.employee_id
      LEFT JOIN payroll p ON p.payment_id = d.payment_id AND p.employee_id = d.employee_id
      WHERE d.status = ANY(${statuses})
        AND (${employeeId}::text IS NULL OR d.employee_id = ${employeeId})
      ORDER BY d.created_at ASC
      LIMIT 200
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST PAYROLL DISCREPANCIES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch discrepancy reports" }, 500);
  }
}

// Body: { id, status: "in_review" | "resolved" | "rejected", response }
// A response is required to close a report, so the employee knows the outcome.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.prepare");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown; response?: unknown };
    const id = Number(body.id);
    const status = body.status;
    const response = typeof body.response === "string" && body.response.trim() ? body.response.trim().slice(0, 2000) : null;

    if (!Number.isInteger(id) || id <= 0 || typeof status !== "string" || !["in_review", "resolved", "rejected"].includes(status)) {
      return withCors(req, { success: false, error: "id and status (in_review, resolved or rejected) are required" }, 400);
    }
    if (status !== "in_review" && !response) {
      return withCors(req, { success: false, error: "A response is required to resolve or reject a report" }, 400);
    }

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: `payroll.discrepancy.${status}`, targetType: "payroll_discrepancy", targetId: id, reason: response, details: {} },
      [db`
        UPDATE payroll_discrepancies
        SET status = ${status}, hr_response = COALESCE(${response}, hr_response),
            handled_by = ${auth.ctx.user.username}, handled_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status IN ('open', 'in_review')
        RETURNING employee_id, category
      `]
    );
    const report = updated?.[0];
    if (!report) {
      return withCors(req, { success: false, error: "Report not found or already closed" }, 409);
    }

    const label = status === "in_review" ? "is being reviewed" : status === "resolved" ? "has been resolved" : "was not upheld";
    await notify(String(report.employee_id), "payroll", {
      title: "Salary discrepancy report updated",
      message: `Your report ${label}.${response ? ` HR: ${response}` : ""}`,
      link: "/employee/payslips",
    });

    return withCors(req, { success: true, message: `Report marked ${status.replace("_", " ")}` });
  } catch (error) {
    console.error("UPDATE PAYROLL DISCREPANCY ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the report" }, 500);
  }
}
