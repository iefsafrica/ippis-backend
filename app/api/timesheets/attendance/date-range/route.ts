import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { recordScope } from "@/lib/mda-scope";

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
    const auth = await requirePermission(req, "timesheets.attendance.view");
    if (!auth.ok) return auth.response;

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

    // Only the attendance of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "timesheets.attendance.view");
    const result = await sql`
      SELECT a.*
      FROM attendance a
      LEFT JOIN employees e ON e.id = a.employee_code
      WHERE a.attendance_date BETWEEN ${start_date} AND ${end_date}
        AND (${department}::text IS NULL OR a.department = ${department})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY a.attendance_date ASC
    `;

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