import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);
const VIEW_AUDIT = "audit.logs.view";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW_AUDIT);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.toLowerCase().trim();
    const targetUserId = searchParams.get("target_user_id") || searchParams.get("user_id");
    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || "50") || 50));
    const offset = (page - 1) * limit;

    const rows = await db`
      SELECT id, actor_id, actor_username, action, target_type, target_id, reason, details, created_at
      FROM audit_logs
      WHERE (${targetUserId}::text IS NULL OR target_id = ${targetUserId} OR actor_id = ${targetUserId})
      ORDER BY created_at DESC, id DESC
      LIMIT 200
    `;

    // Map to frontend AuditEvent interface
    let mapped = rows.map((r) => {
      const details = (typeof r.details === "object" && r.details !== null ? r.details : {}) as Record<string, any>;
      const targetUserName =
        details.full_name ||
        details.username ||
        details.target_user_name ||
        (r.target_id ? `User ${r.target_id}` : "System Resource");

      return {
        id: `AUD-${r.id}`,
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        actor_name: String(r.actor_username || "Administrator"),
        actor_id: r.actor_id ? String(r.actor_id) : undefined,
        action: String(r.action || "UPDATE_USER"),
        target_user_id: r.target_id ? String(r.target_id) : "N/A",
        target_user_name: String(targetUserName),
        reason: String(r.reason || "Authorised administrative operation"),
        details,
      };
    });

    if (search) {
      mapped = mapped.filter(
        (l) =>
          l.target_user_name.toLowerCase().includes(search) ||
          l.actor_name.toLowerCase().includes(search) ||
          l.reason.toLowerCase().includes(search) ||
          l.action.toLowerCase().includes(search) ||
          String(l.target_user_id).toLowerCase().includes(search)
      );
    }

    const total = mapped.length;
    const paginated = mapped.slice(offset, offset + limit);

    return withCors(req, {
      success: true,
      data: {
        logs: paginated,
        total,
        pagination: { total, page, limit },
      },
    });
  } catch (error: any) {
    console.error("GET USER AUDIT TRAIL ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to fetch audit trail" }, 500);
  }
}
