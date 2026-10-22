import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { notify } from "@/lib/employee-notifications";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

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

// Whether the leave exists and its employee is inside the caller's scope
async function leaveInScope(ctx: Parameters<typeof employeeInScope>[0], id: number) {
  if (!Number.isInteger(id)) return false;
  const [row] = await sql`SELECT employee_code FROM leaves WHERE id = ${id}`;
  return !!row && (await employeeInScope(ctx, "timesheets.leaves.manage", row.employee_code));
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
    const auth = await requirePermission(req, "timesheets.leaves.view");
    if (!auth.ok) return auth.response;


    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    // Only the leave of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "timesheets.leaves.view");

    if (id) {

      const result = await sql`
        SELECT l.*,
        (l.to_date - l.from_date) + 1 AS days
        FROM leaves l
        LEFT JOIN employees e ON e.id = l.employee_code
        WHERE l.id = ${Number(id)}
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      `;

      if (!result.length) {
        return withCors(req,{
          success:false,
          message:OUT_OF_SCOPE
        },404);
      }

      return withCors(req,{
        success:true,
        data:result[0]
      });
    }

    const result = await sql`
      SELECT l.*,
      (l.to_date - l.from_date) + 1 AS days
      FROM leaves l
      LEFT JOIN employees e ON e.id = l.employee_code
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY l.created_at DESC
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
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;


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

    if (!(await employeeInScope(auth.ctx, "timesheets.leaves.manage", employee.id))) {
      return withCors(req,{ success:false, message:OUT_OF_SCOPE },404);
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

    await runAudited(req, auth.ctx, { action: "timesheets.leave.created", targetType: "timesheets.leave", details: {} }, []);

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
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;


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

    if (!(await leaveInScope(auth.ctx, Number(id)))) {
      return withCors(req,{ success:false, message:OUT_OF_SCOPE },404);
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

    await runAudited(req, auth.ctx, { action: "timesheets.leave.updated", targetType: "timesheets.leave", details: {} }, []);

    // Tell the employee when their request is decided
    const decided = typeof status === "string" ? status.toLowerCase() : null;
    if (decided === "approved" || decided === "rejected") {
      const leave = result[0] as any;
      await notify(String(leave.employee_code), "leave", {
        title: `Leave request ${decided}`,
        message: `Your ${leave.leave_type} leave request was ${decided}.`,
        link: "/employee/leave",
      });
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
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;


    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {

      return withCors(req,{
        success:false,
        message:"Leave ID required"
      },400);

    }

    if (!(await leaveInScope(auth.ctx, Number(id)))) {
      return withCors(req,{ success:false, message:OUT_OF_SCOPE },404);
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

    await runAudited(req, auth.ctx, { action: "timesheets.leave.deleted", targetType: "timesheets.leave", details: {} }, []);

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