import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate, can, covers, readReason, runAudited, type AuthContext, type Scope } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

/**
 * Access reviews: an access administrator periodically confirms who should
 * still hold what in an MDA. Starting a review takes a snapshot of every role
 * and direct permission granted in that MDA (or, with no MDA, of the grants
 * that apply across all MDAs). Each grant is then kept or revoked; revoking
 * removes it at once. Nobody reviews their own access, and a review can only
 * be completed when every grant has a decision. Every step is audited.
 */

const ASSIGN = "access.roles.assign";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/** Whether the caller may run the review of this MDA (null = grants across all MDAs). */
function mayReview(ctx: AuthContext, companyId: number | null) {
  if (!can(ctx, ASSIGN)) return false;
  const scope: Scope = companyId === null
    ? { level: "global", companyId: null, departmentId: null }
    : { level: "mda", companyId, departmentId: null };
  return covers(ctx, ASSIGN, scope);
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

// GET            reviews the caller may run, newest first
// GET ?id=       one review with its grants and progress
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (!can(auth.ctx, ASSIGN)) return withCors(req, { success: false, error: "Access reviews need access.roles.assign" }, 403);

    const id = num(new URL(req.url).searchParams.get("id"));
    if (id !== null) {
      const [review] = await db`SELECT r.*, c.name AS mda_name FROM access_reviews r LEFT JOIN companies c ON c.id = r.company_id WHERE r.id = ${id}`;
      if (!review || !mayReview(auth.ctx, num(review.company_id))) {
        return withCors(req, { success: false, error: "Not found or outside your organisational scope" }, 404);
      }
      const items = await db`
        SELECT i.*, d.name AS department_name FROM access_review_items i
        LEFT JOIN departments d ON d.id = i.department_id
        WHERE i.review_id = ${id} ORDER BY i.username, i.grant_key
      `;
      const decided = items.filter((i: any) => i.decision).length;
      return withCors(req, {
        success: true,
        data: { ...review, progress: { total: items.length, decided, revoked: items.filter((i: any) => i.decision === "revoke").length }, items },
      });
    }

    const reviews = await db`
      SELECT r.*, c.name AS mda_name,
             (SELECT COUNT(*) FROM access_review_items i WHERE i.review_id = r.id)::int AS total,
             (SELECT COUNT(*) FROM access_review_items i WHERE i.review_id = r.id AND i.decision IS NOT NULL)::int AS decided
      FROM access_reviews r LEFT JOIN companies c ON c.id = r.company_id
      ORDER BY r.started_at DESC
      LIMIT 200
    `;
    return withCors(req, {
      success: true,
      data: reviews
        .filter((r: any) => mayReview(auth.ctx, num(r.company_id)))
        .map((r: any) => ({ ...r, overdue: r.status === "open" && new Date(r.due_at).getTime() < Date.now() })),
    });
  } catch (error) {
    console.error("LIST ACCESS REVIEWS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch access reviews" }, 500);
  }
}

// Body: { company_id (or null for grants across all MDAs), due_in_days?, note? }
// Starts a review: a snapshot of every current grant there.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = num(body.company_id ?? body.mda_id);
    const dueInDays = num(body.due_in_days) ?? 30;
    if (companyId !== null && !Number.isInteger(companyId)) return withCors(req, { success: false, error: "company_id is not valid" }, 400);
    if (!Number.isInteger(dueInDays) || dueInDays < 1 || dueInDays > 180) {
      return withCors(req, { success: false, error: "due_in_days must be 1 to 180" }, 400);
    }
    if (!mayReview(auth.ctx, companyId)) {
      return withCors(req, {
        success: false,
        error: companyId === null ? "Reviewing grants across all MDAs needs access.roles.assign across all MDAs" : "Reviewing this MDA needs access.roles.assign over it",
      }, 403);
    }
    if (companyId !== null) {
      const [mda] = await db`SELECT id FROM companies WHERE id = ${companyId}`;
      if (!mda) return withCors(req, { success: false, error: "MDA not found" }, 404);
    }

    try {
      const [created, items] = await runAudited(
        req,
        auth.ctx,
        { action: "access.review.started", targetType: "mda", targetId: companyId, reason: readReason(body.note), details: { due_in_days: dueInDays } },
        [
          db`
            INSERT INTO access_reviews (company_id, started_by, due_at, note)
            VALUES (${companyId}, ${auth.ctx.user.username}, NOW() + make_interval(days => ${dueInDays}), ${readReason(body.note)})
            RETURNING *
          `,
          // The snapshot: active grants in this MDA (any department of it), or across all MDAs
          db`
            INSERT INTO access_review_items (review_id, user_id, username, kind, role_id, permission_id, grant_key, grant_name,
                                             scope_level, company_id, department_id, expires_at, assigned_by, assigned_at)
            SELECT currval(pg_get_serial_sequence('access_reviews', 'id')), g.user_id, u.username, g.kind, g.role_id, g.permission_id,
                   g.grant_key, g.grant_name, g.scope_level, g.company_id, g.department_id, g.expires_at, g.assigned_by, g.assigned_at
            FROM (
              SELECT ur.user_id, 'role' AS kind, ur.role_id, NULL::int AS permission_id, r.key AS grant_key, r.name AS grant_name,
                     ur.scope_level, ur.company_id, ur.department_id, ur.expires_at, ur.assigned_by, ur.assigned_at
              FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              UNION ALL
              SELECT up.user_id, 'permission', NULL, up.permission_id, p.key, p.name,
                     up.scope_level, up.company_id, up.department_id, up.expires_at, up.assigned_by, up.assigned_at
              FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
            ) g
            LEFT JOIN admin_users u ON u.id::text = g.user_id
            WHERE (g.expires_at IS NULL OR g.expires_at > NOW())
              AND (CASE WHEN ${companyId}::int IS NULL THEN g.scope_level = 'global' ELSE g.company_id = ${companyId}::int END)
            RETURNING id
          `,
        ]
      );
      const review = (created as any[])[0];
      return withCors(req, { success: true, message: `Review started with ${(items as any[]).length} grant(s) to decide`, data: review }, 201);
    } catch (error: any) {
      if (error?.code === "23505") return withCors(req, { success: false, error: "A review of this MDA is already open" }, 409);
      throw error;
    }
  } catch (error) {
    console.error("START ACCESS REVIEW ERROR:", error);
    return withCors(req, { success: false, error: "Failed to start the access review" }, 500);
  }
}

// Body, one of:
//   { item_ids: [..], decision: "keep" | "revoke", note? }   decide grants (revoking removes them now)
//   { review_id, action: "complete" }                        close a review once every grant is decided
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "complete") {
      const reviewId = num(body.review_id);
      const [review] = reviewId === null ? [] : await db`SELECT * FROM access_reviews WHERE id = ${reviewId}`;
      if (!review || !mayReview(auth.ctx, num(review.company_id))) {
        return withCors(req, { success: false, error: "Not found or outside your organisational scope" }, 404);
      }
      if (review.status !== "open") return withCors(req, { success: false, error: "This review is already completed" }, 409);
      const [left] = await db`SELECT COUNT(*)::int AS n FROM access_review_items WHERE review_id = ${reviewId} AND decision IS NULL`;
      if ((left?.n ?? 0) > 0) return withCors(req, { success: false, error: `${left?.n} grant(s) still need a decision` }, 409);
      await runAudited(req, auth.ctx, { action: "access.review.completed", targetType: "mda", targetId: review.company_id, details: { review_id: reviewId } }, [
        db`UPDATE access_reviews SET status = 'completed', completed_by = ${auth.ctx.user.username}, completed_at = NOW() WHERE id = ${reviewId} AND status = 'open'`,
      ]);
      return withCors(req, { success: true, message: "Review completed" });
    }

    const ids = Array.isArray(body.item_ids) ? [...new Set(body.item_ids.map(Number).filter(Number.isInteger))] : [];
    const decision = body.decision;
    const note = readReason(body.note);
    if (ids.length === 0 || (decision !== "keep" && decision !== "revoke")) {
      return withCors(req, { success: false, error: "item_ids and decision (keep or revoke) are required" }, 400);
    }
    if (decision === "revoke" && !note) return withCors(req, { success: false, error: "A note is required to revoke" }, 400);

    const items = await db`
      SELECT i.*, r.company_id AS review_company_id, r.status AS review_status
      FROM access_review_items i JOIN access_reviews r ON r.id = i.review_id
      WHERE i.id = ANY(${ids}::int[])
    `;
    if (items.length !== ids.length) return withCors(req, { success: false, error: "Some items were not found" }, 404);
    for (const item of items) {
      if (!mayReview(auth.ctx, num(item.review_company_id))) {
        return withCors(req, { success: false, error: "Not found or outside your organisational scope" }, 404);
      }
      if (item.review_status !== "open") return withCors(req, { success: false, error: "That review is already completed" }, 409);
      if (item.user_id === auth.ctx.userId) {
        return withCors(req, { success: false, error: "You cannot review your own access; another reviewer must" }, 403);
      }
    }

    const statements = [
      db`
        UPDATE access_review_items SET decision = ${decision}, decided_by = ${auth.ctx.user.username}, decided_at = NOW(), note = ${note}
        WHERE id = ANY(${ids}::int[])
      `,
    ];
    if (decision === "revoke") {
      const payload = JSON.stringify(items.map((i: any) => ({
        user_id: i.user_id, kind: i.kind, role_id: i.role_id, permission_id: i.permission_id,
        company_id: i.company_id, department_id: i.department_id,
      })));
      statements.push(
        db`
          DELETE FROM user_roles ur USING jsonb_to_recordset(${payload}::jsonb)
            AS x(user_id text, kind text, role_id int, permission_id int, company_id int, department_id int)
          WHERE x.kind = 'role' AND ur.user_id = x.user_id AND ur.role_id = x.role_id
            AND ur.company_id IS NOT DISTINCT FROM x.company_id AND ur.department_id IS NOT DISTINCT FROM x.department_id
        `,
        db`
          DELETE FROM user_permissions up USING jsonb_to_recordset(${payload}::jsonb)
            AS x(user_id text, kind text, role_id int, permission_id int, company_id int, department_id int)
          WHERE x.kind = 'permission' AND up.user_id = x.user_id AND up.permission_id = x.permission_id
            AND up.company_id IS NOT DISTINCT FROM x.company_id AND up.department_id IS NOT DISTINCT FROM x.department_id
        `
      );
    }
    await runAudited(
      req,
      auth.ctx,
      {
        action: `access.review.${decision === "keep" ? "kept" : "revoked"}`,
        targetType: "access_review",
        targetId: Number(items[0]!.review_id),
        reason: note,
        details: { grants: items.map((i: any) => `${i.username ?? i.user_id}: ${i.kind} ${i.grant_key} (${i.scope_level})`) },
      },
      statements
    );
    return withCors(req, { success: true, message: `${ids.length} grant(s) ${decision === "keep" ? "kept" : "revoked"}` });
  } catch (error) {
    console.error("DECIDE ACCESS REVIEW ERROR:", error);
    return withCors(req, { success: false, error: "Failed to record the review decision" }, 500);
  }
}
