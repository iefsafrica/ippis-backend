import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate, can, covers, readReason, runAudited, type Scope } from "@/lib/rbac";
import { checkRoleAssignment } from "@/lib/role-grants";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

/**
 * Temporary access to another MDA (or one of its departments): a user asks
 * for a role there until a date, with a reason; an access administrator who
 * covers that MDA approves it. The role is granted with that end date and
 * stops working by itself; an approver can revoke it sooner. Nobody approves
 * their own request, and the usual assignment rules (privileged roles,
 * separation of duties) apply.
 */

const ASSIGN = "access.roles.assign";
const MAX_DAYS = 90;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function scopeOfRequest(row: any): Scope {
  return {
    level: row.scope_level,
    companyId: Number(row.company_id),
    departmentId: row.department_id == null ? null : Number(row.department_id),
  };
}

// ?status=pending|approved|rejected|cancelled|revoked
// The caller's own requests, and the requests they can decide.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const status = new URL(req.url).searchParams.get("status");

    const rows = await db`
      SELECT a.*, r.key AS role_key, r.name AS role_name, c.name AS mda_name, d.name AS department_name,
             u.username, u.full_name
      FROM access_requests a
      JOIN roles r ON r.id = a.role_id
      JOIN companies c ON c.id = a.company_id
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN admin_users u ON u.id::text = a.user_id
      WHERE (${status}::text IS NULL OR a.status = ${status})
      ORDER BY a.created_at DESC
      LIMIT 300
    `;
    const canDecide = can(auth.ctx, ASSIGN);
    const mine = rows.filter((r: any) => r.user_id === auth.ctx.userId);
    const toDecide = canDecide
      ? rows.filter((r: any) => r.user_id !== auth.ctx.userId && covers(auth.ctx, ASSIGN, scopeOfRequest(r)))
      : [];
    return withCors(req, { success: true, data: { mine, to_decide: toDecide } });
  } catch (error) {
    console.error("LIST ACCESS REQUESTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch access requests" }, 500);
  }
}

// Body: { role_id, company_id, department_id?, until: "YYYY-MM-DD" or ISO time, reason }
// Asks for a role in an MDA (or a department of it) for the signed-in user.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const roleId = Number(body.role_id);
    const companyId = Number(body.company_id ?? body.mda_id);
    const departmentId = body.department_id === undefined || body.department_id === null || body.department_id === "" ? null : Number(body.department_id);
    const reason = readReason(body.reason);
    const until = new Date(String(body.until ?? ""));

    if (!Number.isInteger(roleId) || !Number.isInteger(companyId)) {
      return withCors(req, { success: false, error: "role_id and company_id are required" }, 400);
    }
    if (!reason) return withCors(req, { success: false, error: "A reason is required" }, 400);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      return withCors(req, { success: false, error: "until must be a future date" }, 400);
    }
    if (until.getTime() > Date.now() + MAX_DAYS * 86400_000) {
      return withCors(req, { success: false, error: `Temporary access can last at most ${MAX_DAYS} days` }, 400);
    }

    const [role] = await db`SELECT id, name, status FROM roles WHERE id = ${roleId}`;
    if (!role || role.status !== "active") return withCors(req, { success: false, error: "Role not found" }, 404);
    const [mda] = await db`SELECT id, status FROM companies WHERE id = ${companyId}`;
    if (!mda || String(mda.status ?? "active").toLowerCase() !== "active") {
      return withCors(req, { success: false, error: "company_id must be an active MDA" }, 400);
    }
    if (departmentId !== null) {
      const [dept] = await db`SELECT id FROM departments WHERE id = ${departmentId} AND company_id = ${companyId}`;
      if (!dept) return withCors(req, { success: false, error: "That department does not belong to that MDA" }, 400);
    }

    const [created] = await runAudited(
      req,
      auth.ctx,
      { action: "access.temporary.requested", targetType: "user", targetId: auth.ctx.userId, reason, details: { role_id: roleId, company_id: companyId, department_id: departmentId, until: until.toISOString() } },
      [db`
        INSERT INTO access_requests (user_id, role_id, scope_level, company_id, department_id, reason, ends_at)
        VALUES (${auth.ctx.userId}, ${roleId}, ${departmentId === null ? "mda" : "department"}, ${companyId}, ${departmentId}, ${reason}, ${until.toISOString()})
        RETURNING *
      `]
    ).catch((error: any) => {
      if (error?.code === "23505") return [[]];
      throw error;
    });
    if (!created?.[0]) {
      return withCors(req, { success: false, error: "You already have a pending request for this role there" }, 409);
    }
    return withCors(req, { success: true, message: "Request sent for approval", data: created[0] }, 201);
  } catch (error) {
    console.error("CREATE ACCESS REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to create the access request" }, 500);
  }
}

// Body: { id, decision: "approve" | "reject" | "revoke" | "cancel", note? }
//   approve / reject   an access administrator covering the MDA (not the requester)
//   revoke             ends approved access early
//   cancel             the requester withdraws a pending request
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; note?: unknown };
    const id = Number(body.id);
    const decision = String(body.decision ?? "");
    const note = readReason(body.note);
    if (!Number.isInteger(id) || !["approve", "reject", "revoke", "cancel"].includes(decision)) {
      return withCors(req, { success: false, error: "id and decision (approve, reject, revoke or cancel) are required" }, 400);
    }

    const [request] = await db`SELECT * FROM access_requests WHERE id = ${id}`;
    if (!request) return withCors(req, { success: false, error: "Request not found" }, 404);
    const scope = scopeOfRequest(request);
    const own = request.user_id === auth.ctx.userId;

    if (decision === "cancel") {
      if (!own) return withCors(req, { success: false, error: "Only the requester can cancel a request" }, 403);
      const [done] = await runAudited(req, auth.ctx, { action: "access.temporary.cancelled", targetType: "user", targetId: request.user_id, details: { request_id: id } },
        [db`UPDATE access_requests SET status = 'cancelled', decided_at = NOW() WHERE id = ${id} AND status = 'pending' RETURNING id`]);
      if (!done?.[0]) return withCors(req, { success: false, error: `This request is already ${request.status}` }, 409);
      return withCors(req, { success: true, message: "Request cancelled" });
    }

    // Deciding needs the assignment permission over that MDA, and not your own request
    if (own) return withCors(req, { success: false, error: "You cannot decide your own access request" }, 403);
    if (!can(auth.ctx, ASSIGN) || !covers(auth.ctx, ASSIGN, scope)) {
      return withCors(req, { success: false, error: "Deciding this request needs access.roles.assign over that MDA" }, 403);
    }

    if (decision === "reject") {
      if (!note) return withCors(req, { success: false, error: "A note is required to reject" }, 400);
      const [done] = await runAudited(req, auth.ctx, { action: "access.temporary.rejected", targetType: "user", targetId: request.user_id, reason: note, details: { request_id: id } },
        [db`UPDATE access_requests SET status = 'rejected', decided_by = ${auth.ctx.user.username}, decided_at = NOW(), decision_note = ${note} WHERE id = ${id} AND status = 'pending' RETURNING id`]);
      if (!done?.[0]) return withCors(req, { success: false, error: `This request is already ${request.status}` }, 409);
      return withCors(req, { success: true, message: "Request rejected" });
    }

    if (decision === "revoke") {
      if (request.status !== "approved") return withCors(req, { success: false, error: "Only approved access can be revoked" }, 409);
      // Only this temporary grant is removed, so authority over its MDA (checked
      // above) is enough; privileged roles also need the right to grant them
      const [role] = await db`
        SELECT bool_or(p.is_privileged) AS privileged FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ${request.role_id}
      `;
      if (role?.privileged && !can(auth.ctx, "access.privileged.grant")) {
        return withCors(req, { success: false, error: "Removing a privileged role needs access.privileged.grant" }, 403);
      }
      await runAudited(req, auth.ctx, { action: "access.temporary.revoked", targetType: "user", targetId: request.user_id, reason: note, details: { request_id: id } }, [
        db`DELETE FROM user_roles WHERE id = ${request.grant_id}`,
        db`UPDATE access_requests SET status = 'revoked', decided_by = ${auth.ctx.user.username}, decided_at = NOW(), decision_note = COALESCE(${note}, decision_note) WHERE id = ${id}`,
      ]);
      return withCors(req, { success: true, message: "Temporary access revoked" });
    }

    // approve
    if (request.status !== "pending") return withCors(req, { success: false, error: `This request is already ${request.status}` }, 409);
    if (new Date(request.ends_at).getTime() <= Date.now()) {
      return withCors(req, { success: false, error: "The requested end date has passed; ask for a new request" }, 409);
    }
    const check = await checkRoleAssignment(auth.ctx, request.user_id, [Number(request.role_id)], scope);
    if (!check.ok) return withCors(req, { success: false, error: check.error, ...(check.conflicts ? { conflicts: check.conflicts } : {}) }, check.status);

    try {
      const results = await runAudited(
        req,
        auth.ctx,
        { action: "access.temporary.approved", targetType: "user", targetId: request.user_id, reason: note ?? request.reason, details: { request_id: id, role_id: request.role_id, scope, until: request.ends_at } },
        [
          db`
            INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, expires_at, assigned_by, reason)
            VALUES (${request.user_id}, ${request.role_id}, ${scope.level}, ${scope.companyId}, ${scope.departmentId}, ${request.ends_at}, ${auth.ctx.userId}, ${"Temporary access: " + request.reason})
            RETURNING id
          `,
          db`
            UPDATE access_requests
            SET status = 'approved', decided_by = ${auth.ctx.user.username}, decided_at = NOW(), decision_note = ${note},
                grant_id = (SELECT id FROM user_roles WHERE user_id = ${request.user_id} AND role_id = ${request.role_id}
                              AND company_id IS NOT DISTINCT FROM ${scope.companyId}::int AND department_id IS NOT DISTINCT FROM ${scope.departmentId}::int
                            ORDER BY id DESC LIMIT 1)
            WHERE id = ${id} AND status = 'pending'
          `,
        ]
      );
      return withCors(req, { success: true, message: `Access granted until ${new Date(request.ends_at).toISOString().slice(0, 10)}`, data: { grant_id: (results[0] as any[])[0]?.id } });
    } catch (error: any) {
      if (error?.code === "23505") {
        return withCors(req, { success: false, error: "The user already holds this role there, or in another scope on a database where database/mda-completion-migration.sql has not been run" }, 409);
      }
      throw error;
    }
  } catch (error) {
    console.error("DECIDE ACCESS REQUEST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to decide the access request" }, 500);
  }
}
