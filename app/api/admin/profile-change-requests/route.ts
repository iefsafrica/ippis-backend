import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import {
  EDITABLE_FIELDS,
  type EditableField,
  currentProfileValues,
  applyChangeStatements,
  emailTaken,
} from "@/lib/employee-profile";
import { notify } from "@/lib/employee-notifications";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const STATUSES = ["pending", "approved", "rejected", "cancelled"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?status=pending (default) | approved | rejected | cancelled | all
// ?employee_id=  one employee's requests
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";
    const employeeId = searchParams.get("employee_id");
    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20") || 20));

    if (status !== "all" && !STATUSES.includes(status)) {
      return withCors(req, { success: false, error: `status must be one of: ${[...STATUSES, "all"].join(", ")}` }, 400);
    }
    const filter = status === "all" ? null : status;
    // Only the requests of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "employees.records.view");

    const rows = await db`
      SELECT r.id, r.employee_id, e.name AS employee_name, e.department, r.status, r.changes,
             r.employee_note, r.reviewed_by, r.reviewed_at, r.review_note, r.created_at
      FROM employee_profile_change_requests r
      JOIN employees e ON e.id = r.employee_id
      WHERE (${filter}::text IS NULL OR r.status = ${filter})
        AND (${employeeId}::text IS NULL OR r.employee_id = ${employeeId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      -- Pending requests oldest first (a queue); decided ones newest first
      ORDER BY CASE WHEN ${filter}::text = 'pending' THEN r.created_at END ASC, r.created_at DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    const totals = await db`
      SELECT COUNT(*)::int AS count FROM employee_profile_change_requests r
      JOIN employees e ON e.id = r.employee_id
      WHERE (${filter}::text IS NULL OR r.status = ${filter})
        AND (${employeeId}::text IS NULL OR r.employee_id = ${employeeId})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
    `;

    return withCors(req, {
      success: true,
      data: { requests: rows, fieldLabels: EDITABLE_FIELDS, pagination: { total: totals[0]?.count ?? 0, page, limit } },
    });
  } catch (error) {
    console.error("LIST PROFILE CHANGE REQUESTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch profile change requests" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject", note? }
// A note is required to reject, so the employee knows why.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.records.approve");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const decision = body.decision;
    const note = readReason(body.note);

    if (!Number.isInteger(id) || id <= 0 || (decision !== "approve" && decision !== "reject")) {
      return withCors(req, { success: false, error: "id and decision (approve or reject) are required" }, 400);
    }
    if (decision === "reject" && !note) {
      return withCors(req, { success: false, error: "A note is required when rejecting, so the employee knows why" }, 400);
    }

    const rows = await db`
      SELECT id, employee_id, status, changes FROM employee_profile_change_requests WHERE id = ${id}
    `;
    const request = rows[0];
    if (!request || !(await employeeInScope(auth.ctx, "employees.records.approve", request.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }
    if (request.status !== "pending") {
      return withCors(req, { success: false, error: `This request is already ${request.status}` }, 409);
    }

    const employeeId = String(request.employee_id);
    const stored = request.changes as Record<string, { from: string | null; to: string }>;
    const changes: Partial<Record<EditableField, string>> = {};
    for (const [field, change] of Object.entries(stored)) {
      if (field in EDITABLE_FIELDS) changes[field as EditableField] = change.to;
    }

    const outcome = decision === "approve" ? "approved" : "rejected";

    // Claims the request. If another reviewer decided it first, this matches no row,
    // and the guard below aborts the whole transaction so nothing else is written.
    const decide = db`
      UPDATE employee_profile_change_requests
      SET status = ${outcome},
          reviewed_by = ${auth.ctx.user.username},
          reviewed_at = NOW(),
          review_note = ${note},
          updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING id
    `;
    // Divides by zero unless the row was claimed by this transaction (NOW() is fixed per transaction)
    const guard = db`
      SELECT 1 / (
        SELECT COUNT(*)::int FROM employee_profile_change_requests
        WHERE id = ${id} AND status = ${outcome} AND reviewed_at = NOW()
      ) AS claimed
    `;
    const lostRace = () => withCors(req, { success: false, error: "This request was decided by someone else" }, 409);

    if (decision === "reject") {
      try {
        await runAudited(
          req,
          auth.ctx,
          { action: "employees.profile_change.rejected", targetType: "employee", targetId: employeeId, reason: note, details: { request_id: id, fields: Object.keys(changes) } },
          [decide, guard]
        );
      } catch (error: any) {
        if (error?.code === "22012") return lostRace();
        throw error;
      }
      await notify(employeeId, "profile", {
        title: "Profile change rejected",
        message: `HR did not approve your profile change: ${note}`,
        link: "/employee/profile",
      });
      return withCors(req, { success: true, message: "Change request rejected" });
    }

    if (changes.email && (await emailTaken(changes.email, employeeId))) {
      return withCors(req, {
        success: false,
        error: "The new email address is now used by another employee. Reject this request with a note.",
      }, 409);
    }

    const current = await currentProfileValues(employeeId);
    try {
      await runAudited(
        req,
        auth.ctx,
        { action: "employees.profile_change.approved", targetType: "employee", targetId: employeeId, reason: note, details: { request_id: id, changes: stored } },
        [decide, guard, ...applyChangeStatements(employeeId, current, changes, id)]
      );
    } catch (error: any) {
      if (error?.code === "22012") return lostRace();
      if (error?.code === "23505") {
        return withCors(req, { success: false, error: "The new email address is already in use. Reject this request with a note." }, 409);
      }
      throw error;
    }

    await notify(employeeId, "profile", {
      title: "Profile change approved",
      message: "HR approved your profile change and your record has been updated.",
      link: "/employee/profile",
    });
    return withCors(req, { success: true, message: "Change request approved and applied to the employee record" });
  } catch (error) {
    console.error("DECIDE PROFILE CHANGE REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the change request" }, 500);
  }
}
