import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { moduleScope } from "@/lib/module-scope";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET TRAINING TYPES WITH DETAILS
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.view");
    if (!auth.ok) return auth.response;
    // Only the programmes of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "training.records.view");

    // Fetch training types with details
    const result = await sql`
      SELECT
        type,
        category,
        duration,
        CASE WHEN required THEN 'Required' ELSE 'Optional' END AS required,
        CASE WHEN certification THEN 'Yes' ELSE 'No' END AS certification,
        COUNT(*) AS trainings,
        status
      FROM training_programs t
      WHERE (${sc.all}::boolean OR t.company_id = ANY(${sc.companyIds}::int[]) OR t.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND t.company_id IS NULL))
      GROUP BY type, category, duration, required, certification, status
      ORDER BY type ASC
    `;

    return withCors(req, {
      success: true,
      message: "Training types fetched successfully",
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Fetch training types error:", error);

    return withCors(req, {
      success: false,
      message: "Error fetching training types",
      total: 0,
      data: [],
    }, 500);
  }
}