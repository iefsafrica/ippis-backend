import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../lib/cors";

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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // 👉 GET ONE
    if (id) {
      const result = await sql`
        SELECT * FROM training_programs
        WHERE id = ${id}
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
      SELECT * FROM training_programs
      ORDER BY id DESC
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

    const result = await sql`
      INSERT INTO training_programs
      (training_title, type, trainer, start_date, participants, cost, status)
      VALUES (
        ${training_title},
        ${type},
        ${trainer},
        ${start_date},
        ${participants},
        ${cost},
        ${status}
      )
      RETURNING *
    `;

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

    const result = await sql`
      UPDATE training_programs SET
        training_title = ${training_title},
        type = ${type},
        trainer = ${trainer},
        start_date = ${start_date},
        participants = ${participants},
        cost = ${cost},
        status = ${status},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;

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

    const result = await sql`
      DELETE FROM training_programs
      WHERE id = ${id}
      RETURNING *
    `;

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