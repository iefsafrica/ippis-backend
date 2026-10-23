import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Type
// -------------------------
interface TrainingBody {
  training_title: string;
  type: string;
  trainer: string;
  start_date: string;
  participants: number;
  cost: number;
  status: string;
}

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET (ALL or ONE)
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    // Only the programmes of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "training.records.view");

    // 👉 GET ONE
    if (id) {
      const result = await sql`
        SELECT * FROM training_programs t
        WHERE t.id = ${id} AND (${sc.all}::boolean OR t.company_id = ANY(${sc.companyIds}::int[]) OR t.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND t.company_id IS NULL))
      `;

      return withCors(req, {
        success: true,
        message: result[0]
          ? "Training fetched successfully"
          : "Training not found",
        data: result[0] || null,
      });
    }

    // 👉 GET ALL
    const trainings = await sql`
      SELECT * FROM training_programs t
      WHERE (${sc.all}::boolean OR t.company_id = ANY(${sc.companyIds}::int[]) OR t.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND t.company_id IS NULL))
      ORDER BY t.id DESC
    `;

    return withCors(req, {
      success: true,
      message: "Trainings fetched successfully",
      total: trainings.length,
      data: trainings,
    });

  } catch (error) {
    console.error("GET error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Error fetching trainings",
      },
      500
    );
  }
}

// -------------------------
// CREATE
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as TrainingBody;

    const {
      training_title,
      type,
      trainer,
      start_date,
      participants,
      cost,
      status,
    } = body;

    if (!training_title || !start_date) {
      return withCors(
        req,
        {
          success: false,
          message: "training_title and start_date are required",
        },
        400
      );
    }

    // The programme belongs to an MDA inside the caller's scope
    const placed = await placementFor(auth.ctx, "training.records.manage", body as unknown as Record<string, unknown>);
    if (!placed.ok) return withCors(req, { success: false, message: placed.error }, placed.status);

    const result = await sql`
      INSERT INTO training_programs
      (training_title, type, trainer, start_date, participants, cost, status, company_id, department_id)
      VALUES (
        ${training_title},
        ${type},
        ${trainer},
        ${start_date},
        ${participants},
        ${cost},
        ${status},
        ${placed.placement.companyId},
        ${placed.placement.departmentId}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "training.record.created", targetType: "training.record", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Training created successfully",
      data: result[0],
    });

  } catch (error) {
    console.error("POST error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Error creating training",
      },
      500
    );
  }
}

// -------------------------
// UPDATE
// -------------------------
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(
        req,
        {
          success: false,
          message: "ID is required",
        },
        400
      );
    }

    const body = (await req.json()) as TrainingBody;

    const {
      training_title,
      type,
      trainer,
      start_date,
      participants,
      cost,
      status,
    } = body;

    const [existing] = await sql`SELECT company_id, department_id FROM training_programs WHERE id = ${id}`;
    if (!canChange(auth.ctx, "training.records.manage", existing)) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }
    const placed = await placementFor(auth.ctx, "training.records.manage", body as unknown as Record<string, unknown>, placementOf(existing));
    if (!placed.ok) return withCors(req, { success: false, message: placed.error }, placed.status);

    const result = await sql`
      UPDATE training_programs SET
        training_title = ${training_title},
        type = ${type},
        trainer = ${trainer},
        start_date = ${start_date},
        participants = ${participants},
        cost = ${cost},
        status = ${status},
        company_id = ${placed.placement.companyId},
        department_id = ${placed.placement.departmentId},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "training.record.updated", targetType: "training.record", details: {} }, []);

    return withCors(req, {
      success: true,
      message: result[0]
        ? "Training updated successfully"
        : "Training not found",
      data: result[0] || null,
    });

  } catch (error) {
    console.error("PUT error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Error updating training",
      },
      500
    );
  }
}

// -------------------------
// DELETE
// -------------------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(
        req,
        {
          success: false,
          message: "ID is required",
        },
        400
      );
    }

    const [existing] = await sql`SELECT company_id, department_id FROM training_programs WHERE id = ${id}`;
    if (!canChange(auth.ctx, "training.records.manage", existing)) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      DELETE FROM training_programs
      WHERE id = ${id}
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "training.record.deleted", targetType: "training.record", details: {} }, []);

    return withCors(req, {
      success: true,
      message: result.length
        ? "Training deleted successfully"
        : "Training not found",
    });

  } catch (error) {
    console.error("DELETE error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Error deleting training",
      },
      500
    );
  }
}