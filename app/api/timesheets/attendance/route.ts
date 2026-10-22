import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Types
// -------------------------
type Attendance = {
  id: number;
  employee_code: string; // Maps to employees.id
  employee_name: string;
  department: string | null;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: "present" | "absent" | "late" | "leave";
  notes: string | null;
  created_at: string;
};

type CreateAttendanceBody = {
  employee_code: string;
  attendance_date: string;
  clock_in?: string;
  clock_out?: string;
  status: "present" | "absent" | "late" | "leave";
  notes?: string;
};

type UpdateAttendanceBody = {
  id: number;
  clock_in?: string;
  clock_out?: string;
  status?: "present" | "absent" | "late" | "leave";
  notes?: string;
};

// Whether the attendance record exists and its employee is inside the caller's scope
async function attendanceInScope(ctx: Parameters<typeof employeeInScope>[0], id: number) {
  if (!Number.isInteger(id)) return false;
  const [row] = await sql`SELECT employee_code FROM attendance WHERE id = ${id}`;
  return !!row && (await employeeInScope(ctx, "timesheets.attendance.manage", row.employee_code));
}

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id"); // attendance ID
    const employee_code = searchParams.get("employee_code");
    // Only the attendance of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "timesheets.attendance.view");

    if (idParam) {
      const result = await sql`
        SELECT a.* FROM attendance a LEFT JOIN employees e ON e.id = a.employee_code
        WHERE a.id = ${Number(idParam)}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      `;
      if (!result.length) return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
      return withCors(req, { success: true, data: result[0] });
    }

    const result = await sql`
      SELECT a.* FROM attendance a LEFT JOIN employees e ON e.id = a.employee_code
      WHERE (${employee_code}::text IS NULL OR a.employee_code = ${employee_code})
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY a.attendance_date DESC
    `;
    return withCors(req, { success: true, data: result });
  } catch (error) {
    console.error("Attendance GET error:", error);
    return withCors(req, { success: false, message: "Unexpected error fetching attendance" }, 500);
  }
}

// -------------------------
// POST (Mark Attendance)
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as CreateAttendanceBody;
    const { employee_code, attendance_date, clock_in, clock_out, status, notes } = body;

    if (!employee_code || !attendance_date || !status) {
      return withCors(req, { success: false, message: "employee_code, attendance_date, and status are required" }, 400);
    }

    // ✅ Check employee exists
    const employeeResult = await sql`
      SELECT id, name, department
      FROM employees
      WHERE id = ${employee_code}
      LIMIT 1
    `;
    const employee = employeeResult[0];
    if (!employee) return withCors(req, { success: false, message: `Employee with ID ${employee_code} does not exist` }, 404);
    if (!(await employeeInScope(auth.ctx, "timesheets.attendance.manage", employee.id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    // ✅ Prevent duplicate attendance
    const existing = await sql`
      SELECT id
      FROM attendance
      WHERE employee_code = ${employee_code} AND attendance_date = ${attendance_date}
      LIMIT 1
    `;
    if (existing.length > 0) return withCors(req, { success: false, message: "Attendance already marked for this employee on this date" }, 400);

    // ✅ Insert attendance
    const result = await sql`
      INSERT INTO attendance (
        employee_code,
        employee_name,
        department,
        attendance_date,
        clock_in,
        clock_out,
        status,
        notes
      ) VALUES (
        ${employee.id},
        ${employee.name},
        ${employee.department ?? null},
        ${attendance_date},
        ${clock_in ?? null},
        ${clock_out ?? null},
        ${status},
        ${notes ?? null}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "timesheets.attendance.created", targetType: "timesheets.attendance", details: {} }, []);

    return withCors(req, { success: true, data: result[0] });
  } catch (error: any) {
    console.error("Attendance POST error:", error);
    if (error?.code === "23505") {
      return withCors(req, { success: false, message: "Attendance already exists for this employee on this date" }, 400);
    }
    return withCors(req, { success: false, message: "Unexpected server error while creating attendance" }, 500);
  }
}

// -------------------------
// PUT (Update Attendance)
// -------------------------
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as UpdateAttendanceBody;
    const { id, clock_in, clock_out, status, notes } = body;

    if (!id) return withCors(req, { success: false, message: "Attendance ID required" }, 400);
    if (!(await attendanceInScope(auth.ctx, Number(id)))) return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);

    const result = await sql`
      UPDATE attendance
      SET
        clock_in = COALESCE(${clock_in}, clock_in),
        clock_out = COALESCE(${clock_out}, clock_out),
        status = COALESCE(${status}, status),
        notes = COALESCE(${notes}, notes)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, message: "Attendance not found" }, 404);

    await runAudited(req, auth.ctx, { action: "timesheets.attendance.updated", targetType: "timesheets.attendance", details: {} }, []);

    return withCors(req, { success: true, data: result[0] });
  } catch (error) {
    console.error("Attendance PUT error:", error);
    return withCors(req, { success: false, message: "Unexpected error updating attendance" }, 500);
  }
}

// -------------------------
// DELETE
// -------------------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.attendance.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, message: "Attendance ID required" }, 400);
    if (!(await attendanceInScope(auth.ctx, Number(id)))) return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);

    const result = await sql`
      DELETE FROM attendance
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, message: "Attendance not found" }, 404);

    await runAudited(req, auth.ctx, { action: "timesheets.attendance.deleted", targetType: "timesheets.attendance", details: {} }, []);

    return withCors(req, { success: true, message: "Attendance deleted successfully", data: result[0] });
  } catch (error) {
    console.error("Attendance DELETE error:", error);
    return withCors(req, { success: false, message: "Unexpected error deleting attendance" }, 500);
  }
}