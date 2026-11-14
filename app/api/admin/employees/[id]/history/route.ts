import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { recordScope, inScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// 3. GET: Get Employee Update History (Audit Trail)
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(req, "employees.records.view");
    if (!auth.ok) return auth.response;

    const params = await props.params;
    const rawId = decodeURIComponent(params.id || "").trim();
    if (!rawId) {
      return withCors(req, { success: false, error: "Employee ID is required" }, 400);
    }

    // Verify employee exists and check MDA scope
    const empRows = await sql`
      SELECT id, registration_id, company_id, department_id 
      FROM employees 
      WHERE id = ${rawId} OR registration_id = ${rawId}
      LIMIT 1
    `;

    const emp = empRows[0];
    if (!emp) {
      return withCors(req, { success: false, error: `Employee '${rawId}' not found` }, 404);
    }

    const sc = recordScope(auth.ctx, "employees.records.view");
    const isAllowed = sc.all || emp.company_id == null || inScope(sc, emp.company_id, emp.department_id);
    if (!isAllowed) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 403);
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20")));
    const offset = (page - 1) * limit;

    const empId = String(emp.id);
    const regId = emp.registration_id ? String(emp.registration_id) : empId;

    const rows = await sql`
      SELECT 
        a.id,
        a.target_id,
        a.action,
        a.actor_id,
        a.actor_username,
        a.reason,
        a.details,
        a.created_at,
        u.id AS user_id,
        u.full_name AS user_fullname,
        u.email AS user_email,
        u.role AS user_role
      FROM audit_logs a
      LEFT JOIN admin_users u ON (u.id::text = a.actor_id OR u.username = a.actor_username)
      WHERE a.target_type IN ('employee', 'employees')
        AND (a.target_id = ${empId} OR a.target_id = ${regId})
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM audit_logs a
      WHERE a.target_type IN ('employee', 'employees')
        AND (a.target_id = ${empId} OR a.target_id = ${regId})
    `;

    const total = Number(countResult?.[0]?.total || 0);

    const history = rows.map((r: any) => {
      let changes: any[] = [];
      if (Array.isArray(r.details?.changes)) {
        changes = r.details.changes;
      } else if (r.details && typeof r.details === "object") {
        // If old/new or single field was stored
        changes = Object.entries(r.details).map(([key, val]) => ({
          field: key,
          label: key,
          old_value: "",
          new_value: typeof val === "object" ? JSON.stringify(val) : String(val),
        }));
      }

      return {
        id: `hist_${r.id}`,
        employee_id: String(r.target_id || empId),
        action: String(r.action || "UPDATE").toUpperCase(),
        changed_by: {
          id: String(r.user_id || r.actor_id || "admin_1"),
          name: r.user_fullname || r.actor_username || "Super Administrator",
          email: r.user_email || (r.actor_username ? `${r.actor_username}@ippis.gov.ng` : "admin@ippis.gov.ng"),
          role: r.user_role || "Super Administrator",
        },
        reason: r.reason || "Employee update",
        changes,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      };
    });

    return withCors(req, {
      success: true,
      data: {
        history,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error: any) {
    console.error("GET EMPLOYEE HISTORY ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch employee history", details: error?.message }, 500);
  }
}

