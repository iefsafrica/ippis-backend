import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { INVITE_VALID_HOURS } from "@/lib/employee-auth";
import { inviteToPortal } from "@/lib/employee-invite";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// Employee portal accounts are user accounts, so they follow the account permissions
const VIEW = "users.accounts.view";
const MANAGE = "users.accounts.manage";

const STATUSES = ["invited", "active", "suspended", "deactivated"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- LIST EMPLOYEE ACCOUNTS ----------------
// ?employee_id=  one employee (with or without an account)
// ?status=       invited | active | suspended | deactivated | none (employees without an account)
// ?search=       name, email or staff ID
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employee_id");
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim() || null;
    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20") || 20));
    const offset = (page - 1) * limit;

    if (status && status !== "none" && !STATUSES.includes(status)) {
      return withCors(req, { success: false, error: `status must be one of: ${[...STATUSES, "none"].join(", ")}` }, 400);
    }

    const pattern = search ? `%${search}%` : null;
    const rows = await db`
      SELECT e.id AS employee_id, e.name, e.email, e.department, e.position, e.status AS employee_status,
             COALESCE(a.status, 'none') AS account_status,
             a.invited_at, a.invited_by, a.invite_expires_at, a.last_login_at, a.created_at AS account_created_at
      FROM employees e
      LEFT JOIN employee_accounts a ON a.employee_id = e.id
      WHERE (${employeeId}::text IS NULL OR e.id = ${employeeId})
        AND (${status}::text IS NULL OR COALESCE(a.status, 'none') = ${status})
        AND (${pattern}::text IS NULL OR e.name ILIKE ${pattern} OR e.email ILIKE ${pattern} OR e.id ILIKE ${pattern})
      ORDER BY e.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const totals = await db`
      SELECT COUNT(*)::int AS count
      FROM employees e
      LEFT JOIN employee_accounts a ON a.employee_id = e.id
      WHERE (${employeeId}::text IS NULL OR e.id = ${employeeId})
        AND (${status}::text IS NULL OR COALESCE(a.status, 'none') = ${status})
        AND (${pattern}::text IS NULL OR e.name ILIKE ${pattern} OR e.email ILIKE ${pattern} OR e.id ILIKE ${pattern})
    `;

    return withCors(req, {
      success: true,
      data: { accounts: rows, pagination: { total: totals[0]?.count ?? 0, page, limit } },
    });
  } catch (error) {
    console.error("LIST EMPLOYEE ACCOUNTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch employee accounts" }, 500);
  }
}

// ---------------- INVITE ----------------
// Body: { employee_id, reason? }
// Creates the account if needed and emails a link to set a password.
// Sending again replaces the previous link.
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { employee_id?: string; reason?: string };
    const employeeId = typeof body.employee_id === "string" ? body.employee_id.trim() : "";
    if (!employeeId) {
      return withCors(req, { success: false, error: "employee_id is required" }, 400);
    }

    const result = await inviteToPortal(employeeId, auth.ctx.user.username);
    // A 502 means the invite exists but its email failed, so it is still recorded
    if (result.ok || result.status === 502) {
      await runAudited(req, auth.ctx, {
        action: "users.employee_account.invited",
        targetType: "employee",
        targetId: employeeId,
        reason: readReason(body.reason),
        details: result.ok ? { email: result.email, resend: result.resent } : { email_failed: true },
      }, []);
    }
    if (!result.ok) {
      return withCors(req, { success: false, error: result.error }, result.status);
    }

    return withCors(req, {
      success: true,
      message: `Invite sent to ${result.email}. The link is valid for ${INVITE_VALID_HOURS} hours.`,
      data: { employee_id: employeeId, account_status: "invited" },
    });
  } catch (error) {
    console.error("INVITE EMPLOYEE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to invite employee" }, 500);
  }
}

// ---------------- CHANGE ACCOUNT STATUS ----------------
// Body: { employee_id, status: "active" | "suspended" | "deactivated", reason }
// Suspending or deactivating ends the employee's sessions immediately.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { employee_id?: string; status?: string; reason?: string };
    const employeeId = typeof body.employee_id === "string" ? body.employee_id.trim() : "";
    const status = body.status;
    const reason = readReason(body.reason);

    if (!employeeId || !status) {
      return withCors(req, { success: false, error: "employee_id and status are required" }, 400);
    }
    if (!["active", "suspended", "deactivated"].includes(status)) {
      return withCors(req, { success: false, error: "status must be active, suspended or deactivated" }, 400);
    }
    if (!reason) {
      return withCors(req, { success: false, error: "reason is required" }, 400);
    }

    const rows = await db`
      SELECT status, password_hash IS NOT NULL AS has_password
      FROM employee_accounts WHERE employee_id = ${employeeId}
    `;
    const account = rows[0];
    if (!account) {
      return withCors(req, { success: false, error: "Employee has no portal account. Send an invite first." }, 404);
    }
    if (account.status === status) {
      return withCors(req, { success: false, error: `Account is already ${status}` }, 409);
    }
    if (status === "active" && !account.has_password) {
      return withCors(req, {
        success: false,
        error: "The employee has not set a password yet. Send a new invite instead.",
      }, 409);
    }

    const ending = status !== "active";
    await runAudited(
      req,
      auth.ctx,
      {
        action: `users.employee_account.${status === "active" ? "reactivated" : status}`,
        targetType: "employee",
        targetId: employeeId,
        reason,
        details: { from: account.status, to: status },
      },
      [
        db`
          UPDATE employee_accounts
          SET status = ${status},
              token_version = CASE WHEN ${ending} THEN token_version + 1 ELSE token_version END,
              invite_token_hash = CASE WHEN ${ending} THEN NULL ELSE invite_token_hash END,
              reset_token_hash = CASE WHEN ${ending} THEN NULL ELSE reset_token_hash END,
              updated_at = NOW()
          WHERE employee_id = ${employeeId}
        `,
      ]
    );

    return withCors(req, {
      success: true,
      message: `Account ${status === "active" ? "reactivated" : status}`,
      data: { employee_id: employeeId, account_status: status },
    });
  } catch (error) {
    console.error("UPDATE EMPLOYEE ACCOUNT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update employee account" }, 500);
  }
}
