import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

export const dynamic = "force-dynamic";

// =========================
// OPTIONS (CORS preflight)
// =========================
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// =========================
// GET (all goals or single by id)
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const result = await sql`
        SELECT g.*, gt.goal_type
        FROM goals g
        LEFT JOIN goal_types gt ON g.goal_type_id = gt.id
        WHERE g.id = ${id}
      `;

      if (!result.length)
        return withCors(req, { success: false, error: "Goal not found" }, 404);

      return withCors(req, { success: true, data: result[0] });
    }

    const all = await sql`
      SELECT g.*, gt.goal_type
      FROM goals g
      LEFT JOIN goal_types gt ON g.goal_type_id = gt.id
      ORDER BY g.created_at DESC
    `;

    return withCors(req, { success: true, data: all });
  } catch (error) {
    console.error("GET error:", error);
    return withCors(req, { success: false, error: "Failed to fetch goals" }, 500);
  }
}

// =========================
// POST (create goal)
// =========================
export async function POST(req: NextRequest) {
  try {
    let body: {
      employee_id?: number;
      goal_type_id?: number;
      title?: string;
      description?: string;
      status?: string;
      target_date?: string;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { employee_id, goal_type_id, title, description, status, target_date } = body;

    if (!employee_id || !goal_type_id || !title)
      return withCors(req, { success: false, error: "employee_id, goal_type_id, and title are required" }, 400);

    const inserted = await sql`
      INSERT INTO goals (employee_id, goal_type_id, title, description, status, target_date, created_at)
      VALUES (${employee_id}, ${goal_type_id}, ${title}, ${description ?? null}, ${status ?? 'pending'}, ${target_date ?? null}, NOW())
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Goal created successfully",
      data: inserted[0],
    }, 201);

  } catch (error) {
    console.error("POST error:", error);
    return withCors(req, { success: false, error: "Failed to create goal" }, 500);
  }
}

// =========================
// PUT (update goal)
// =========================
export async function PUT(req: NextRequest) {
  try {
    let body: {
      id?: number;
      employee_id?: number;
      goal_type_id?: number;
      title?: string;
      description?: string;
      status?: string;
      target_date?: string;
      achieved?: boolean;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { id, employee_id, goal_type_id, title, description, status, target_date, achieved } = body;

    if (!id)
      return withCors(req, { success: false, error: "Goal ID is required" }, 400);

    const updated = await sql`
      UPDATE goals
      SET
        employee_id = COALESCE(${employee_id ?? null}, employee_id),
        goal_type_id = COALESCE(${goal_type_id ?? null}, goal_type_id),
        title = COALESCE(${title ?? null}, title),
        description = COALESCE(${description ?? null}, description),
        status = COALESCE(${status ?? null}, status),
        target_date = COALESCE(${target_date ?? null}, target_date),
        achieved = COALESCE(${achieved ?? null}, achieved),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!updated.length)
      return withCors(req, { success: false, error: "Goal not found" }, 404);

    return withCors(req, { success: true, message: "Goal updated successfully", data: updated[0] });

  } catch (error) {
    console.error("PUT error:", error);
    return withCors(req, { success: false, error: "Failed to update goal" }, 500);
  }
}

// =========================
// DELETE (goal)
// =========================
export async function DELETE(req: NextRequest) {
  try {
    let body: { id?: number } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { id } = body;
    if (!id)
      return withCors(req, { success: false, error: "Goal ID is required" }, 400);

    const deleted = await sql`
      DELETE FROM goals
      WHERE id = ${id}
      RETURNING *
    `;

    if (!deleted.length)
      return withCors(req, { success: false, error: "Goal not found" }, 404);

    return withCors(req, { success: true, message: "Goal deleted successfully", data: deleted[0] });

  } catch (error) {
    console.error("DELETE error:", error);
    return withCors(req, { success: false, error: "Failed to delete goal" }, 500);
  }
}