import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { keepInScope } from "@/lib/mda-scope";

const sql = neon(process.env.DATABASE_URL!);

// OPTIONS
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET — Fetch promoted employees
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "corehr.records.view");
    if (!auth.ok) return auth.response;

    const query = `
      SELECT 
        ep.id               AS promotion_id,
        ep.employee_id      AS employee_id,
        ep.department       AS department,
        ep.previous_position AS previous_position,
        ep.new_position     AS new_position,
        ep.effective_date   AS effective_date,
        ep.reason           AS reason,
        ep.created_at       AS created_at,
        ep.updated_at       AS updated_at,
        e.name              AS employee_name,
        e.email             AS employee_email,
        e.position          AS current_position
      FROM employee_promotions ep
      INNER JOIN employees e 
        ON e.id = ep.employee_id
      ORDER BY ep.effective_date DESC
    `;

    // Only the promotions of employees inside the caller's MDA or department
    const result = await keepInScope(auth.ctx, "corehr.records.view", await sql.query(query));

    return withCors(req, {
      success: true,
      message: "Promoted employees fetched successfully.",
      count: result.length,
      data: result,
    });
  } catch (err: any) {
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch promoted employees.",
        details: err?.message ?? String(err),
      },
      500
    );
  }
}
