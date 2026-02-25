import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Types
// -------------------------
type Appraiser = {
  id: number;
  employee_id: string;
  department_id: number;
  designation_id: number;
  appraisal_date: string;
  status: string;
  rating?: number;
  remarks?: string;
  added_by?: string;
  created_at: string;
  updated_at: string;
};

type CreateAppraiserBody = {
  employee_id: string;
  department_id: number;
  designation_id: number;
  appraisal_date: string;
  status?: string;
  rating?: number;
  remarks?: string;
  added_by?: string;
};

type UpdateAppraiserBody = {
  id: number;
  employee_id?: string;
  department_id?: number;
  designation_id?: number;
  appraisal_date?: string;
  status?: string;
  rating?: number;
  remarks?: string;
};

// =========================
// CORS preflight
// =========================
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// =========================
// GET
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const result = await sql`
        SELECT pa.*, d.name AS department_name, des.title AS designation_name
        FROM performance_appraisers pa
        LEFT JOIN departments d ON pa.department_id = d.id
        LEFT JOIN designations des ON pa.designation_id = des.id
        WHERE pa.id = ${id}
      `;
      if (!result.length)
        return withCors(req, { success: false, message: "Appraiser not found" }, 404);

      return withCors(req, { success: true, data: result[0] });
    }

    const all = await sql`
      SELECT pa.*, d.name AS department_name, des.title AS designation_name
      FROM performance_appraisers pa
      LEFT JOIN departments d ON pa.department_id = d.id
      LEFT JOIN designations des ON pa.designation_id = des.id
      ORDER BY pa.created_at DESC
    `;

    return withCors(req, { success: true, data: all });
  } catch (error) {
    console.error("GET error:", error);
    return withCors(req, { success: false, message: "Failed to fetch appraisers" }, 500);
  }
}

// =========================
// POST
// =========================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateAppraiserBody;
    const { employee_id, department_id, designation_id, appraisal_date, status, rating, remarks, added_by } = body;

    if (!employee_id || !department_id || !designation_id || !appraisal_date)
      return withCors(req, { success: false, message: "employee_id, department_id, designation_id and appraisal_date are required" }, 400);

    const inserted = await sql`
      INSERT INTO performance_appraisers
        (employee_id, department_id, designation_id, appraisal_date, status, rating, remarks, added_by, created_at, updated_at)
      VALUES
        (${employee_id}, ${department_id}, ${designation_id}, ${appraisal_date}, ${status ?? 'scheduled'}, ${rating ?? null}, ${remarks ?? null}, ${added_by ?? null}, NOW(), NOW())
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Appraiser created successfully", data: inserted[0] }, 201);

  } catch (error) {
    console.error("POST error:", error);
    return withCors(req, { success: false, message: "Failed to create appraiser", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// =========================
// PUT
// =========================
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateAppraiserBody;
    const { id, employee_id, department_id, designation_id, appraisal_date, status, rating, remarks } = body;

    if (!id)
      return withCors(req, { success: false, message: "Appraiser ID is required" }, 400);

    const updated = await sql`
      UPDATE performance_appraisers
      SET
        employee_id = COALESCE(${employee_id ?? null}, employee_id),
        department_id = COALESCE(${department_id ?? null}, department_id),
        designation_id = COALESCE(${designation_id ?? null}, designation_id),
        appraisal_date = COALESCE(${appraisal_date ?? null}, appraisal_date),
        status = COALESCE(${status ?? null}, status),
        rating = COALESCE(${rating ?? null}, rating),
        remarks = COALESCE(${remarks ?? null}, remarks),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!updated.length)
      return withCors(req, { success: false, message: "Appraiser not found" }, 404);

    return withCors(req, { success: true, message: "Appraiser updated successfully", data: updated[0] });

  } catch (error) {
    console.error("PUT error:", error);
    return withCors(req, { success: false, message: "Failed to update appraiser", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// =========================
// DELETE
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { id?: number };
    const { id } = body;

    if (!id)
      return withCors(req, { success: false, message: "Appraiser ID is required" }, 400);

    const deleted = await sql`DELETE FROM performance_appraisers WHERE id = ${id} RETURNING *`;

    if (!deleted.length)
      return withCors(req, { success: false, message: "Appraiser not found" }, 404);

    return withCors(req, { success: true, message: "Appraiser deleted successfully", data: deleted[0] });

  } catch (error) {
    console.error("DELETE error:", error);
    return withCors(req, { success: false, message: "Failed to delete appraiser", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}