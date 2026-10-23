import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { decisionRefusal } from "@/lib/approvals";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "corehr.records.approve");
    if (!auth.ok) return auth.response;

    const { id, reason } = ((await req.json().catch(() => ({}))) ?? {}) as {
      id?: number;
      reason?: string;
    };
    // Whoever is signed in disapproves; a name in the request is ignored
    const disapproved_by = auth.ctx.user.username;

    if (!id) {
      return withCors(req, {
        success: false,
        error: "id is required.",
      }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_resignations WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Resignation not found." }, 404);
    }
    const refusal = await decisionRefusal(auth.ctx, "corehr.records.approve", existing[0].employee_id);
    if (refusal) return withCors(req, { success: false, error: refusal.error }, refusal.status);

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending resignations can be disapproved.",
      }, 400);
    }

    const disapproved = await sql`
      UPDATE employee_resignations
      SET
        status = 'disapproved',
        disapproved_by = ${disapproved_by},
        disapproved_at = NOW(),
        disapproval_reason = ${reason},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!disapproved[0]) {
      return withCors(req, { success: false, error: "Disapproval failed." }, 500);
    }

    await runAudited(req, auth.ctx, { action: "corehr.resignation.rejected", targetType: "employee", targetId: String(existing[0].employee_id), reason: reason ?? null, details: { resignation_id: id } }, []);

    return withCors(req, {
      success: true,
      message: "Resignation disapproved successfully",
      data: disapproved[0],
    });
  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to disapprove resignation.",
    }, 500);
  }
}
