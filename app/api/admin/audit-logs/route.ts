import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, scopeOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- READ AUDIT LOGS ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "audit.logs.view");
    if (!auth.ok) return auth.response;

    // Audit events are not tied to an MDA yet, so only a global grant may read them
    if (!scopeOf(auth.ctx, "audit.logs.view").global) {
      return withCors(req, { success: false, error: "Viewing audit logs requires global scope" }, 403);
    }

    const { searchParams } = new URL(req.url);
    const actorId = searchParams.get("actor_id");
    const action = searchParams.get("action");
    const targetType = searchParams.get("target_type");
    const targetId = searchParams.get("target_id");

    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20") || 20));
    const offset = (page - 1) * limit;

    const logs = await db`
      SELECT *
      FROM audit_logs
      WHERE (${actorId}::text IS NULL OR actor_id = ${actorId})
        AND (${action}::text IS NULL OR action = ${action})
        AND (${targetType}::text IS NULL OR target_type = ${targetType})
        AND (${targetId}::text IS NULL OR target_id = ${targetId})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalRes = await db`
      SELECT COUNT(*) FROM audit_logs
      WHERE (${actorId}::text IS NULL OR actor_id = ${actorId})
        AND (${action}::text IS NULL OR action = ${action})
        AND (${targetType}::text IS NULL OR target_type = ${targetType})
        AND (${targetId}::text IS NULL OR target_id = ${targetId})
    `;
    const total = Number(totalRes?.[0]?.count ?? 0);

    return withCors(req, {
      success: true,
      data: {
        logs,
        pagination: { total, page, limit }
      }
    });
  } catch (error: any) {
    console.error("GET AUDIT LOGS ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch audit logs" }, 500);
  }
}
