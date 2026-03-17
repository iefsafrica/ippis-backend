import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
Types
------------------------- */

type Employee = {
  id: string;
  name: string;
  department: string | null;
};

interface CreateLeaveBody {
  employee_code: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  reason?: string;
  status?: "pending" | "approved" | "rejected";
}

interface UpdateLeaveBody {
  id: number;
  leave_type?: string;
  from_date?: string;
  to_date?: string;
  reason?: string;
  status?: "pending" | "approved" | "rejected";
}

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
        return withCors(req,{
          success:false,
          message:"Leave not found"
        },404);
      }

      return withCors(req,{
        success:true,
        data:result[0]
      });
    }

    const result = await sql`
      SELECT *,
      (to_date - from_date) + 1 AS days
      FROM leaves
      ORDER BY created_at DESC
    `;

    return withCors(req,{
      success:true,
      data:result
    });

  } catch (error) {

    console.error("Leave GET error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error fetching leaves"
    },500);
  }
}

/* -------------------------
POST Create Leave
------------------------- */

export async function POST(req: NextRequest) {

  try {

    const body = (await req.json()) as CreateLeaveBody;

    const {
      employee_code,
      leave_type,
      from_date,
      to_date,
      reason,
      status
    } = body;

    if (!employee_code || !leave_type || !from_date || !to_date) {

      return withCors(req,{
        success:false,
        message:"employee_code, leave_type, from_date and to_date are required"
      },400);

    }

    /* -------------------------
       Validate employee_code
    ------------------------- */

    const employeeId = employee_code.trim();

    if (!employeeId) {
      return withCors(req,{
        success:false,
        message:"employee_code is required"
      },400);
    }

    /* -------------------------
       Check Employee Exists
    ------------------------- */

    const employeeRows = await sql`
      SELECT id, name, department
      FROM employees
      WHERE id = ${employeeId}
      LIMIT 1
    `;

    const employee = employeeRows[0] as Employee | undefined;

    if (!employee) {

      return withCors(req,{
        success:false,
        message:`Employee with ID ${employee_code} does not exist`
      },404);

    }

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
        ${employee.id},
        ${employee.name},
        ${employee.department ?? null},
        ${leave_type},
        ${from_date},
        ${to_date},
        ${reason ?? null},
        ${status ?? "pending"}
      )
      RETURNING *
    `;

    return withCors(req,{
      success:true,
      message:"Leave created successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Leave creation error:", error);

    return withCors(req,{
      success:false,
      message:"Failed to create leave"
    },500);

  }
}

/* -------------------------
PUT Update Leave
------------------------- */

export async function PUT(req: NextRequest) {

  try {

    const body = (await req.json()) as UpdateLeaveBody;

    const {
      id,
      leave_type,
      from_date,
      to_date,
      reason,
      status
    } = body;

    if (!id) {

      return withCors(req,{
        success:false,
        message:"Leave ID required"
      },400);

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

      return withCors(req,{
        success:false,
        message:"Leave not found"
      },404);

    }

    return withCors(req,{
      success:true,
      message:"Leave updated successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Leave update error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error updating leave"
    },500);

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

      return withCors(req,{
        success:false,
        message:"Leave ID required"
      },400);

    }

    const result = await sql`
      DELETE FROM leaves
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.length) {

      return withCors(req,{
        success:false,
        message:"Leave not found"
      },404);

    }

    return withCors(req,{
      success:true,
      message:"Leave deleted successfully",
      data:result[0]
    });

  } catch (error) {

    console.error("Leave delete error:", error);

    return withCors(req,{
      success:false,
      message:"Unexpected error deleting leave"
    },500);

  }
}