import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   Types
------------------------- */

type ShiftBody = {
  id?: number;
  shift_name?: string;
  start_time?: string;
  end_time?: string;
  late_mark_time?: string;
  department?: string;
  status?: string;
};

/* -------------------------
   OPTIONS (CORS)
------------------------- */

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   GET (All shifts or single)
------------------------- */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const result = await sql`
        SELECT *
        FROM office_shifts
        WHERE id = ${Number(id)}
      `;

      if (!result.length) {
        return withCors(req, { success: false, message: "Shift not found" }, 404);
      }

      return withCors(req, { success: true, data: result[0] });
    }

    const result = await sql`
      SELECT *
      FROM office_shifts
      ORDER BY id DESC
    `;

    return withCors(req, { success: true, data: result });

  } catch (error) {
    console.error("Shift GET error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error fetching shifts" },
      500
    );
  }
}

/* -------------------------
   POST (Create Shift)
------------------------- */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ShiftBody;

    const {
      shift_name,
      start_time,
      end_time,
      late_mark_time,
      department,
      status,
    } = body;

    if (!shift_name || !start_time || !end_time || !late_mark_time) {
      return withCors(
        req,
        {
          success: false,
          message:
            "shift_name, start_time, end_time and late_mark_time are required",
        },
        400
      );
    }

    const result = await sql`
      INSERT INTO office_shifts (
        shift_name,
        start_time,
        end_time,
        late_mark_time,
        department,
        status
      )
      VALUES (
        ${shift_name},
        ${start_time},
        ${end_time},
        ${late_mark_time},
        ${department ?? null},
        ${status ?? "active"}
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Shift created successfully",
      data: result[0],
    });

  } catch (error) {
    console.error("Shift POST error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error creating shift" },
      500
    );
  }
}

/* -------------------------
   PUT (Update Shift)
------------------------- */

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as ShiftBody;

    const {
      id,
      shift_name,
      start_time,
      end_time,
      late_mark_time,
      department,
      status,
    } = body;

    if (!id) {
      return withCors(req, { success: false, message: "Shift id required" }, 400);
    }

    const result = await sql`
      UPDATE office_shifts
      SET
        shift_name = COALESCE(${shift_name}, shift_name),
        start_time = COALESCE(${start_time}, start_time),
        end_time = COALESCE(${end_time}, end_time),
        late_mark_time = COALESCE(${late_mark_time}, late_mark_time),
        department = COALESCE(${department}, department),
        status = COALESCE(${status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, message: "Shift not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Shift updated successfully",
      data: result[0],
    });

  } catch (error) {
    console.error("Shift PUT error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error updating shift" },
      500
    );
  }
}

/* -------------------------
   DELETE
------------------------- */

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Shift id required" }, 400);
    }

    const result = await sql`
      DELETE FROM office_shifts
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, message: "Shift not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Shift deleted successfully",
      data: result[0],
    });

  } catch (error) {
    console.error("Shift DELETE error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error deleting shift" },
      500
    );
  }
}