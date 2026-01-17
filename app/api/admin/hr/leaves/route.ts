import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/* -------------------- Types -------------------- */
interface LeavePayload {
  id?: number;
  employee_id: string; // employee id from employees.id
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  emergency_contact?: string;
  status?: string;
}

interface EmployeeRow {
  employee_key: string;
  employee_name: string;
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    let leaves;

    if (id) {
      leaves = await sql`SELECT * FROM employee_leaves WHERE id = ${id}`;
    } else if (employee_id) {
      leaves = await sql`
        SELECT * FROM employee_leaves
        WHERE employee_id = ${employee_id}
        ORDER BY start_date ASC
      `;
    } else {
      leaves = await sql`SELECT * FROM employee_leaves ORDER BY start_date ASC`;
    }

    return withCors(req, { success: true, data: leaves });
  } catch (error) {
    console.error("Error fetching leaves:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch leaves",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- POST -------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LeavePayload;
    const { employee_id, leave_type, start_date, end_date, reason, emergency_contact } = body;

    if (!employee_id || !leave_type || !start_date || !end_date || !reason) {
      return withCors(
        req,
        {
          success: false,
          error: "employee_id, leave_type, start_date, end_date, and reason are required",
        },
        400
      );
    }

    // ---------- Validate employee and get name ----------
    const employeeRow = (await sql`
      SELECT id::text AS employee_key, name AS employee_name
      FROM employees
      WHERE id::text = ${employee_id}
    `) as EmployeeRow[];

    if (!employeeRow || employeeRow.length === 0) {
      return withCors(
        req,
        {
          success: false,
          error: "Employee ID does not exist",
          invalid_employee_id: employee_id,
        },
        400
      );
    }

    const employee = employeeRow[0]!; // non-null assertion fixes TS error
    const employee_name = employee.employee_name;

    // ---------- Insert leave ----------
    const result = await sql`
      INSERT INTO employee_leaves (
        employee_id,
        employee_name,
        leave_type,
        start_date,
        end_date,
        reason,
        emergency_contact,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${employee_id},
        ${employee_name},
        ${leave_type},
        ${start_date},
        ${end_date},
        ${reason},
        ${emergency_contact},
        'pending',
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(
      req,
      { success: true, message: "Leave request submitted successfully", data: result[0] },
      201
    );
  } catch (error) {
    console.error("Error creating leave:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to create leave",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- PUT -------------------- */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<LeavePayload>;
    const { id, employee_id } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Leave id is required" }, 400);
    }

    let employee_name: string | undefined;

    // ---------- Validate employee and get name if employee_id is updated ----------
    if (employee_id) {
      const employeeRow = (await sql`
        SELECT id::text AS employee_key, name AS employee_name
        FROM employees
        WHERE id::text = ${employee_id}
      `) as EmployeeRow[];

      if (!employeeRow || employeeRow.length === 0) {
        return withCors(
          req,
          {
            success: false,
            error: "Employee ID does not exist",
            invalid_employee_id: employee_id,
          },
          400
        );
      }

      const employee = employeeRow[0]!; // non-null assertion fixes TS error
      employee_name = employee.employee_name;
    }

    // ---------- Update leave ----------
    const updated = await sql`
      UPDATE employee_leaves
      SET
        employee_id = COALESCE(${body.employee_id}, employee_id),
        employee_name = COALESCE(${employee_name}, employee_name),
        leave_type = COALESCE(${body.leave_type}, leave_type),
        start_date = COALESCE(${body.start_date}, start_date),
        end_date = COALESCE(${body.end_date}, end_date),
        reason = COALESCE(${body.reason}, reason),
        emergency_contact = COALESCE(${body.emergency_contact}, emergency_contact),
        status = COALESCE(${body.status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Leave updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating leave:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to update leave",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- DELETE -------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "Leave id is required" }, 400);
    }

    await sql`DELETE FROM employee_leaves WHERE id = ${id}`;

    return withCors(req, { success: true, message: "Leave deleted successfully" });
  } catch (error) {
    console.error("Error deleting leave:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to delete leave",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
