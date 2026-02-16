import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

// Helper: check if table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* =========================
   GET (All or Single)
   ========================= */
export async function GET(req: NextRequest) {
  try {
    const exists = await tableExists("goal_types");
    if (!exists)
      return withCors(req, { success: false, error: "'goal_types' table does not exist" }, 404);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // GET single
    if (id) {
      const result = await sql`
        SELECT * FROM goal_types
        WHERE id = ${id}
      `;

      if (!result.length)
        return withCors(req, { success: false, error: "Goal type not found" }, 404);

      return withCors(req, { success: true, data: result[0] });
    }

    // GET all
    const goalTypes = await sql`
      SELECT * FROM goal_types
      ORDER BY id ASC
    `;

    return withCors(req, { success: true, data: goalTypes });

  } catch (error) {
    console.error("GET error:", error);
    return withCors(
      req,
      { success: false, error: "Failed to fetch goal types" },
      500
    );
  }
}

/* =========================
   POST (Create)
   ========================= */
export async function POST(req: NextRequest) {
  try {
    let body: { goal_type?: string; description?: string; status?: string } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { goal_type, description, status } = body;

    if (!goal_type || !description || !status)
      return withCors(req, { success: false, error: "Missing required fields" }, 400);

    const exists = await tableExists("goal_types");
    if (!exists)
      return withCors(req, { success: false, error: "'goal_types' table does not exist" }, 404);

    const inserted = await sql`
      INSERT INTO goal_types (goal_type, description, status, created_date)
      VALUES (${goal_type}, ${description}, ${status}, NOW())
      RETURNING *
    `;

    return withCors(
      req,
      {
        success: true,
        message: "Goal type created successfully",
        data: inserted[0],
      },
      201
    );

  } catch (error) {
    console.error("POST error:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to create goal type",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* =========================
   PUT (Update - Partial)
   ========================= */
export async function PUT(req: NextRequest) {
  try {
    let body: {
      id?: string;
      goal_type?: string;
      description?: string;
      status?: string;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { id, goal_type, description, status } = body;

    if (!id)
      return withCors(req, { success: false, error: "Missing 'id' for update" }, 400);

    if (!goal_type && !description && !status)
      return withCors(
        req,
        { success: false, error: "At least one field must be provided to update" },
        400
      );

    const exists = await tableExists("goal_types");
    if (!exists)
      return withCors(req, { success: false, error: "'goal_types' table does not exist" }, 404);

    const updated = await sql`
      UPDATE goal_types
      SET
        goal_type = COALESCE(${goal_type ?? null}, goal_type),
        description = COALESCE(${description ?? null}, description),
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!updated.length)
      return withCors(req, { success: false, error: "Goal type not found" }, 404);

    return withCors(req, {
      success: true,
      message: "Goal type updated successfully",
      data: updated[0],
    });

  } catch (error) {
    console.error("PUT error:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to update goal type",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* =========================
   DELETE
   ========================= */
export async function DELETE(req: NextRequest) {
  try {
    let body: { id?: string } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const { id } = body;

    if (!id)
      return withCors(req, { success: false, error: "Missing 'id' for delete" }, 400);

    const exists = await tableExists("goal_types");
    if (!exists)
      return withCors(
        req,
        { success: false, error: "'goal_types' table does not exist" },
        404
      );

    // Delete and only return id to verify existence
    const deleted = await sql`
      DELETE FROM goal_types
      WHERE id = ${id}
      RETURNING id
    `;

    if (!deleted.length)
      return withCors(req, { success: false, error: "Goal type not found" }, 404);

    return withCors(req, {
      success: true,
      message: "Goal type deleted successfully",
    });

  } catch (error) {
    console.error("DELETE error:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to delete goal type",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
