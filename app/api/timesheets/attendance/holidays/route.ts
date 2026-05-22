import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
Types
------------------------- */

type HolidayBody = {
  id?: number;
  holiday_name?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  status?: string;
};

/* -------------------------
OPTIONS
------------------------- */

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
GET Holidays
------------------------- */

export async function GET(req: NextRequest) {
  try {

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {

      const result = await sql`
        SELECT *,
        (end_date - start_date) + 1 AS days
        FROM holidays
        WHERE id = ${Number(id)}
      `;

      if (!result.length) {
        return withCors(req,{success:false,message:"Holiday not found"},404);
      }

      return withCors(req,{success:true,data:result[0]});
    }

    const result = await sql`
      SELECT *,
      (end_date - start_date) + 1 AS days
      FROM holidays
      ORDER BY start_date DESC
    `;

    return withCors(req,{success:true,data:result});

  } catch (error) {

    console.error("Holiday GET error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error fetching holidays"
    },500);
  }
}

/* -------------------------
POST Create Holiday
------------------------- */

export async function POST(req: NextRequest) {
  try {

    const body = (await req.json()) as HolidayBody;

    const {
      holiday_name,
      start_date,
      end_date,
      description,
      status
    } = body;

    if (!holiday_name || !start_date || !end_date) {
      return withCors(req,{
        success:false,
        message:"holiday_name, start_date and end_date are required"
      },400);
    }

    const result = await sql`
      INSERT INTO holidays (
        holiday_name,
        start_date,
        end_date,
        description,
        status
      )
      VALUES (
        ${holiday_name},
        ${start_date},
        ${end_date},
        ${description ?? null},
        ${status ?? 'active'}
      )
      RETURNING *
    `;

    return withCors(req,{
      success:true,
      message:"Holiday created successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Holiday POST error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error creating holiday"
    },500);
  }
}

/* -------------------------
PUT Update Holiday
------------------------- */

export async function PUT(req: NextRequest) {
  try {

    const body = (await req.json()) as HolidayBody;

    const {
      id,
      holiday_name,
      start_date,
      end_date,
      description,
      status
    } = body;

    if (!id) {
      return withCors(req,{success:false,message:"Holiday id required"},400);
    }

    const result = await sql`
      UPDATE holidays
      SET
        holiday_name = COALESCE(${holiday_name},holiday_name),
        start_date = COALESCE(${start_date},start_date),
        end_date = COALESCE(${end_date},end_date),
        description = COALESCE(${description},description),
        status = COALESCE(${status},status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req,{success:false,message:"Holiday not found"},404);
    }

    return withCors(req,{
      success:true,
      message:"Holiday updated successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Holiday PUT error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error updating holiday"
    },500);
  }
}

/* -------------------------
DELETE Holiday
------------------------- */

export async function DELETE(req: NextRequest) {
  try {

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req,{success:false,message:"Holiday id required"},400);
    }

    const result = await sql`
      DELETE FROM holidays
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req,{success:false,message:"Holiday not found"},404);
    }

    return withCors(req,{
      success:true,
      message:"Holiday deleted successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Holiday DELETE error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error deleting holiday"
    },500);
  }
}