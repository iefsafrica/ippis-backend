import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { todayLagos } from "@/lib/employee-time";
import { APPROVE, loadTransfer, unitOf, coversBothEnds, completeTransfer } from "@/lib/employee-transfer";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { dry_run? }
// Completes the approved transfers whose effective date has come and that the
// caller has authority over at both ends. Meant to be run daily (by HR or a
// scheduled job signed in as a central HR account).
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, APPROVE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { dry_run?: unknown };
    const due = await sql`
      SELECT id FROM employee_transfers
      WHERE status = 'approved' AND effective_date <= ${todayLagos()}::date
      ORDER BY effective_date, id
      LIMIT 200
    `;

    const completed: number[] = [];
    const skipped: { id: number; reason: string }[] = [];
    for (const row of due) {
      const transfer = await loadTransfer(Number(row.id));
      if (!transfer || transfer.to_company_id == null || !coversBothEnds(auth.ctx, APPROVE, unitOf(transfer), unitOf(transfer, "to_"))) {
        continue; // outside the caller's authority: left for someone who has it
      }
      if (body.dry_run === true) {
        completed.push(Number(row.id));
        continue;
      }
      const done = await completeTransfer(req, auth.ctx, transfer, "approved", null);
      if (done.ok) completed.push(Number(row.id));
      else skipped.push({ id: Number(row.id), reason: done.error });
    }

    return withCors(req, {
      success: true,
      message: body.dry_run === true ? `${completed.length} transfer(s) would be completed` : `${completed.length} transfer(s) completed`,
      data: { dry_run: body.dry_run === true, completed, skipped },
    });
  } catch (error) {
    console.error("APPLY DUE TRANSFERS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to apply due transfers" }, 500);
  }
}
