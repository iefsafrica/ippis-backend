import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";

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
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id"); // attendance ID
    const employee_code = searchParams.get("employee_code");

    if (idParam) {
      const result = await sql`SELECT * FROM attendance WHERE id = ${Number(idParam)}`;
      if (!result.length) return withCors(req, { success: false, message: "Attendance not found" }, 404);
      return withCors(req, { success: true, data: result[0] });
    }

    if (employee_code) {
      const result = await sql`
        SELECT * FROM attendance
        WHERE employee_code = ${employee_code}
        ORDER BY attendance_date DESC
      `;
      return withCors(req, { success: true, data: result });
    }

    const result = await sql`SELECT * FROM attendance ORDER BY attendance_date DESC`;
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
    const body = (await req.json()) as UpdateAttendanceBody;
    const { id, clock_in, clock_out, status, notes } = body;

    if (!id) return withCors(req, { success: false, message: "Attendance ID required" }, 400);

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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return withCors(req, { success: false, message: "Attendance ID required" }, 400);

    const result = await sql`
      DELETE FROM attendance
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, message: "Attendance not found" }, 404);

    return withCors(req, { success: true, message: "Attendance deleted successfully", data: result[0] });
  } catch (error) {
    console.error("Attendance DELETE error:", error);
    return withCors(req, { success: false, message: "Unexpected error deleting attendance" }, 500);
  }
}