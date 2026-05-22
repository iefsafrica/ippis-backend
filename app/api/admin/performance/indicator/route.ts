import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
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
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* =========================
   GET (All or Single)
========================= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

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
      `;

      if (!result.length) {
        return withCors(req, { success: false, error: "Indicator not found" }, 404);
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

    const inserted = await sql`
      INSERT INTO performance_indicators
      (indicator_name, department_id, designation_id, description, status, added_by)
      VALUES
      (${indicator_name}, ${department_id}, ${designation_id}, ${description}, ${status ?? "active"}, ${added_by ?? "Admin"})
      RETURNING *
    `;

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

    const deleted = await sql`
      DELETE FROM performance_indicators
      WHERE id = ${id}
      RETURNING *
    `;

    if (!deleted.length) {
      return withCors(req, { success: false, error: "Indicator not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Indicator deleted successfully",
    });

  } catch (error) {
    console.error("DELETE error:", error);
    return withCors(req, { success: false, error: "Failed to delete indicator" }, 500);
  }
}