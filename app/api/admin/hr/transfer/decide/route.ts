import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { OUT_OF_SCOPE } from "@/lib/mda-scope";
import { notify } from "@/lib/employee-notifications";
import { APPROVE, loadTransfer, unitOf, coversBothEnds, coversEitherEnd, completeTransfer, isDue } from "@/lib/employee-transfer";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { id, decision: "approve" | "reject" | "complete", reason? }
//   approve   a pending transfer; it completes at once when its effective date has come
//   complete  an approved transfer whose effective date has come
//   reject    a pending or approved transfer (reason required)
// Approving or completing needs authority over both where the employee is and
// where they are going; the person who requested the transfer, and the person
// being transferred, cannot approve it.
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, APPROVE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; reason?: unknown };
    const id = Number(body.id);
    const decision = body.decision;
    const reason = readReason(body.reason);
    if (!Number.isInteger(id) || id <= 0 || !["approve", "reject", "complete"].includes(String(decision))) {
      return withCors(req, { success: false, error: "id and decision (approve, reject or complete) are required" }, 400);
    }

    const transfer = await loadTransfer(id);
    const from = transfer ? unitOf(transfer) : null;
    const to = transfer && transfer.to_company_id != null ? unitOf(transfer, "to_") : null;
    if (!transfer || !coversEitherEnd(auth.ctx, APPROVE, from!, to)) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    if (decision === "reject") {
      if (!reason) return withCors(req, { success: false, error: "A reason is required to reject a transfer" }, 400);
      const [rejected] = await runAudited(
        req,
        auth.ctx,
        { action: "corehr.transfer.rejected", targetType: "employee", targetId: transfer.employee_id, reason, details: { transfer_id: id } },
        [sql`
          UPDATE employee_transfers
          SET status = 'rejected', rejected_by = ${auth.ctx.user.username}, rejected_at = NOW(), rejection_reason = ${reason}, updated_at = NOW()
          WHERE id = ${id} AND status IN ('pending', 'approved')
          RETURNING id
        `]
      );
      if (!rejected?.[0]) return withCors(req, { success: false, error: `This transfer is already ${transfer.status}` }, 409);
      return withCors(req, { success: true, message: "Transfer rejected" });
    }

    // approve or complete
    const expected = decision === "approve" ? "pending" : "approved";
    if (transfer.status !== expected) {
      return withCors(req, { success: false, error: `Only ${expected} transfers can be ${decision === "approve" ? "approved" : "completed"}; this one is ${transfer.status}` }, 409);
    }
    if (!to) {
      return withCors(req, { success: false, error: "Set the destination (to_company_id or to_department_id) before approving" }, 400);
    }
    if (!coversBothEnds(auth.ctx, APPROVE, from!, to)) {
      return withCors(req, {
        success: false,
        error: "Approving this transfer needs authority over both the employee's current unit and the destination",
      }, 403);
    }
    if (["terminated", "resigned", "deleted"].includes(String(transfer.employee_status ?? "").toLowerCase())) {
      return withCors(req, { success: false, error: `The employee is ${transfer.employee_status}; reject this transfer instead` }, 409);
    }
    if (decision === "approve") {
      // Separation of duties: whoever asked for the transfer, or is being moved, cannot approve it
      if (transfer.requested_by && transfer.requested_by === auth.ctx.user.username) {
        return withCors(req, { success: false, error: "You requested this transfer, so someone else must approve it" }, 403);
      }
      const [me] = await sql`SELECT TRIM(staff_id) AS staff_id FROM admin_users WHERE id = ${auth.ctx.user.id}`;
      if (me?.staff_id && me.staff_id === String(transfer.employee_id)) {
        return withCors(req, { success: false, error: "You cannot approve your own transfer" }, 403);
      }
      const unchanged = ["companyId", "departmentId", "designationId", "locationId"].every(
        (k) => (from as any)[k] === (to as any)[k]
      );
      if (unchanged) return withCors(req, { success: false, error: "The destination is where the employee already is" }, 400);
    }

    if (!isDue(transfer)) {
      if (decision === "complete") {
        return withCors(req, { success: false, error: `This transfer takes effect on ${transfer.effective_date}` }, 409);
      }
      const [approved] = await runAudited(
        req,
        auth.ctx,
        { action: "corehr.transfer.approved", targetType: "employee", targetId: transfer.employee_id, reason, details: { transfer_id: id, effective_date: transfer.effective_date } },
        [sql`
          UPDATE employee_transfers
          SET status = 'approved', approved_by = ${auth.ctx.user.username}, approved_at = NOW(), updated_at = NOW()
          WHERE id = ${id} AND status = 'pending'
          RETURNING id
        `]
      );
      if (!approved?.[0]) return withCors(req, { success: false, error: "This transfer was decided by someone else" }, 409);
      await notify(String(transfer.employee_id), "profile", {
        title: "Transfer approved",
        message: `Your transfer has been approved and takes effect on ${transfer.effective_date}.`,
        link: "/employee/profile",
      });
      return withCors(req, { success: true, message: `Transfer approved; it takes effect on ${transfer.effective_date}`, data: { status: "approved" } });
    }

    const done = await completeTransfer(req, auth.ctx, transfer, expected, reason);
    if (!done.ok) return withCors(req, { success: false, error: done.error }, done.status);
    return withCors(req, {
      success: true,
      message: "Transfer completed: the employee has moved",
      data: {
        status: "completed",
        access: {
          accounts: done.access.accounts,
          removed: done.access.removed.map((g) => ({ account: g.username, type: g.kind, grant: g.grant, scope: g.scope_level })),
          review: done.access.review.map((g) => ({ account: g.username, type: g.kind, grant: g.grant, scope: g.scope_level })),
          sessions_ended: done.access.sessions_ended,
        },
      },
    });
  } catch (error) {
    console.error("DECIDE TRANSFER ERROR:", error);
    return withCors(req, { success: false, error: "Failed to decide the transfer" }, 500);
  }
}
