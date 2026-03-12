import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET Date-wise Attendance
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const start_date = searchParams.get("start_date");
    const end_date = searchParams.get("end_date");
    const department = searchParams.get("department");

    if (!start_date || !end_date) {
      return withCors(
        req,
        {
          success: false,
          message: "start_date and end_date are required",
        },
        400
      );
    }

    let result;

    // Filter with department
    if (department) {
      result = await sql`
        SELECT *
        FROM attendance
        WHERE attendance_date BETWEEN ${start_date} AND ${end_date}
        AND department = ${department}
        ORDER BY attendance_date ASC
      `;
    } else {
      result = await sql`
        SELECT *
        FROM attendance
        WHERE attendance_date BETWEEN ${start_date} AND ${end_date}
        ORDER BY attendance_date ASC
      `;
    }

    return withCors(req, {
      success: true,
      filters: {
        start_date,
        end_date,
        department: department ?? "all",
      },
      total_records: result.length,
      data: result,
    });

  } catch (error) {
    console.error("Date Range Attendance error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Unexpected error fetching date-wise attendance",
      },
      500
    );
  }
}