import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
Types
------------------------- */

type LeaveBody = {
  id?: number;
  employee_code?: string;
  leave_type?: string;
  from_date?: string;
  to_date?: string;
  reason?: string;
  status?: string;
};

/* -------------------------
OPTIONS (CORS)
------------------------- */

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
GET Leaves
------------------------- */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const result = await sql`
        SELECT *,
        (to_date - from_date) + 1 AS days
        FROM leaves
        WHERE id = ${Number(id)}
      `;

      if (!result.length) {
        return withCors(req, { success: false, message: "Leave not found" }, 404);
      }

      return withCors(req, { success: true, data: result[0] });
    }

    const result = await sql`
      SELECT *,
      (to_date - from_date) + 1 AS days
      FROM leaves
      ORDER BY created_at DESC
    `;

    return withCors(req, { success: true, data: result });

  } catch (error) {
    console.error("Leave GET error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error fetching leaves" },
      500
    );
  }
}

/* -------------------------
POST Create Leave
------------------------- */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LeaveBody;

    const {
      employee_code,
      leave_type,
      from_date,
      to_date,
      reason,
      status
    } = body;

    if (!employee_code || !leave_type || !from_date || !to_date) {
      return withCors(
        req,
        {
          success: false,
          message: "employee_code, leave_type, from_date and to_date are required"
        },
        400
      );
    }

    /* -------------------------
       Get Employee Info
    ------------------------- */

    const [employee] = await sql`
      SELECT name, department
      FROM employees
      WHERE id = ${employee_code}
      LIMIT 1
    `;

    if (!employee) {
      return withCors(
        req,
        {
          success: false,
          message: "Employee not found"
        },
        404
      );
    }

    const employee_name = employee.name;
    const department = employee.department;

    /* -------------------------
       Insert Leave
    ------------------------- */

    const result = await sql`
      INSERT INTO leaves (
        employee_code,
        employee_name,
        department,
        leave_type,
        from_date,
        to_date,
        reason,
        status
      )
      VALUES (
        ${employee_code},
        ${employee_name},
        ${department ?? null},
        ${leave_type},
        ${from_date},
        ${to_date},
        ${reason ?? null},
        ${status ?? "pending"}
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Leave created successfully",
      data: result[0]
    });

  } catch (error) {
    console.error("Leave POST error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error creating leave" },
      500
    );
  }
}

/* -------------------------
PUT Update Leave
------------------------- */

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as LeaveBody;

    const {
      id,
      leave_type,
      from_date,
      to_date,
      reason,
      status
    } = body;

    if (!id) {
      return withCors(req, { success: false, message: "Leave id required" }, 400);
    }

    const result = await sql`
      UPDATE leaves
      SET
        leave_type = COALESCE(${leave_type}, leave_type),
        from_date = COALESCE(${from_date}, from_date),
        to_date = COALESCE(${to_date}, to_date),
        reason = COALESCE(${reason}, reason),
        status = COALESCE(${status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, message: "Leave not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Leave updated successfully",
      data: result[0]
    });

  } catch (error) {
    console.error("Leave PUT error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error updating leave" },
      500
    );
  }
}

/* -------------------------
DELETE Leave
------------------------- */

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Leave id required" }, 400);
    }

    const result = await sql`
      DELETE FROM leaves
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, message: "Leave not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Leave deleted successfully",
      data: result[0]
    });

  } catch (error) {
    console.error("Leave DELETE error:", error);

    return withCors(
      req,
      { success: false, message: "Unexpected error deleting leave" },
      500
    );
  }
}