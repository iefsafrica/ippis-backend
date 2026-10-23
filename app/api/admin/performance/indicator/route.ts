import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { recordScope, departmentInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { withCors, handleOptions } from "@/lib/cors";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/* =========================
   Type Definitions
========================= */

interface CreateIndicatorBody {
  indicator_name: string;
  department_id: number;
  designation_id: number;
  description: string;
  status?: "active" | "inactive";
  added_by?: string;
}

interface UpdateIndicatorBody {
  id: number;
  indicator_name?: string;
  department_id?: number;
  designation_id?: number;
  description?: string;
  status?: "active" | "inactive";
}

/* =========================
   OPTIONS (CORS)
========================= */
// Whether the indicator exists and its department is inside the caller's scope
async function indicatorInScope(ctx: Parameters<typeof departmentInScope>[0], id: unknown) {
  const [row] = await sql`SELECT department_id FROM performance_indicators WHERE id::text = ${String(id)}`;
  return !!row && (await departmentInScope(ctx, "performance.records.manage", row.department_id));
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* =========================
   GET (All or Single)
========================= */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "performance.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    // Only the indicators of departments inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "performance.records.view");

    // GET single
    if (id) {
      const result = await sql`
        SELECT pi.*,
               d.name AS department_name,
               des.title AS designation_name
        FROM performance_indicators pi
        LEFT JOIN departments d ON pi.department_id = d.id
        LEFT JOIN designations des ON pi.designation_id = des.id
        WHERE pi.id = ${Number(id)}
          AND (${sc.all}::boolean OR d.company_id = ANY(${sc.companyIds}::int[]) OR d.id = ANY(${sc.departmentIds}::int[]))
      `;

      if (!result.length) {
        return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
      }

      return withCors(req, { success: true, data: result[0] });
    }

    // GET all
    const indicators = await sql`
      SELECT pi.*,
             d.name AS department_name,
             des.title AS designation_name
      FROM performance_indicators pi
      LEFT JOIN departments d ON pi.department_id = d.id
      LEFT JOIN designations des ON pi.designation_id = des.id
      WHERE (${sc.all}::boolean OR d.company_id = ANY(${sc.companyIds}::int[]) OR d.id = ANY(${sc.departmentIds}::int[]))
      ORDER BY pi.created_at DESC
    `;

    return withCors(req, { success: true, data: indicators });

  } catch (error) {
    console.error("GET error:", error);
    return withCors(req, { success: false, error: "Failed to fetch indicators" }, 500);
  }
}

/* =========================
   POST (Create)
========================= */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "performance.records.manage");
    if (!auth.ok) return auth.response;

    let body: CreateIndicatorBody;

    try {
      body = (await req.json()) as CreateIndicatorBody;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const {
      indicator_name,
      department_id,
      designation_id,
      description,
      status,
      added_by
    } = body;

    if (!indicator_name || !department_id || !designation_id || !description) {
      return withCors(req, { success: false, error: "Missing required fields" }, 400);
    }
    if (!(await departmentInScope(auth.ctx, "performance.records.manage", department_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const inserted = await sql`
      INSERT INTO performance_indicators
      (indicator_name, department_id, designation_id, description, status, added_by)
      VALUES
      (${indicator_name}, ${department_id}, ${designation_id}, ${description}, ${status ?? "active"}, ${added_by ?? "Admin"})
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "performance.indicator.created", targetType: "performance.indicator", details: {} }, []);

    return withCors(
      req,
      {
        success: true,
        message: "Performance indicator created successfully",
        data: inserted[0],
      },
      201
    );

  } catch (error) {
    console.error("POST error:", error);
    return withCors(req, { success: false, error: "Failed to create indicator" }, 500);
  }
}

/* =========================
   PUT (Update - Partial)
========================= */
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "performance.records.manage");
    if (!auth.ok) return auth.response;

    let body: UpdateIndicatorBody;

    try {
      body = (await req.json()) as UpdateIndicatorBody;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const {
      id,
      indicator_name,
      department_id,
      designation_id,
      description,
      status
    } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Indicator ID is required" }, 400);
    }
    // The indicator, and any department it is moved to, must be inside the caller's scope
    if (!(await indicatorInScope(auth.ctx, id)) || (department_id && !(await departmentInScope(auth.ctx, "performance.records.manage", department_id)))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const updated = await sql`
      UPDATE performance_indicators
      SET
        indicator_name = COALESCE(${indicator_name ?? null}, indicator_name),
        department_id = COALESCE(${department_id ?? null}, department_id),
        designation_id = COALESCE(${designation_id ?? null}, designation_id),
        description = COALESCE(${description ?? null}, description),
        status = COALESCE(${status ?? null}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!updated.length) {
      return withCors(req, { success: false, error: "Indicator not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "performance.indicator.updated", targetType: "performance.indicator", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Indicator updated successfully",
      data: updated[0],
    });

  } catch (error) {
    console.error("PUT error:", error);
    return withCors(req, { success: false, error: "Failed to update indicator" }, 500);
  }
}

/* =========================
   DELETE
========================= */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "performance.records.manage");
    if (!auth.ok) return auth.response;

    let body: { id?: number };

    try {
      body = (await req.json()) as { id?: number };
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { id } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Indicator ID is required" }, 400);
    }
    if (!(await indicatorInScope(auth.ctx, id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const deleted = await sql`
      DELETE FROM performance_indicators
      WHERE id = ${id}
      RETURNING *
    `;

    if (!deleted.length) {
      return withCors(req, { success: false, error: "Indicator not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "performance.indicator.deleted", targetType: "performance.indicator", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Indicator deleted successfully",
    });

  } catch (error) {
    console.error("DELETE error:", error);
    return withCors(req, { success: false, error: "Failed to delete indicator" }, 500);
  }
}