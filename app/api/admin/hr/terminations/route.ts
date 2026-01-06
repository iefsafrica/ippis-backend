import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/* -------------------- Payload -------------------- */
interface TerminationPayload {
  id?: number;

  employee_id: string;
  employee_name?: string;
  position?: string;
  department?: string;

  termination_type: string;
  termination_reason: string;
  termination_date: string; // YYYY-MM-DD

  status?: string;
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
/**
 * GET all terminations
 * GET by id -> ?id=1
 * GET by employee -> ?employee_id=EMP001
 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'employee_terminations'
      )
    `;

    if (!tableExists[0]?.exists) {
      return withCors(req, {
        success: false,
        error: "'employee_terminations' table does not exist.",
      }, 404);
    }

    let terminations;

    if (id) {
      terminations = await sql`
        SELECT *
        FROM employee_terminations
        WHERE id = ${id}
      `;
    } else if (employee_id) {
      terminations = await sql`
        SELECT *
        FROM employee_terminations
        WHERE employee_id = ${employee_id}
        ORDER BY termination_date DESC
      `;
    } else {
      terminations = await sql`
        SELECT *
        FROM employee_terminations
        ORDER BY termination_date DESC
      `;
    }

    return withCors(req, { success: true, data: terminations });
  } catch (error) {
    console.error("Error fetching terminations:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch terminations.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- POST -------------------- */
/**
 * Create new termination
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<TerminationPayload>;

    const {
      employee_id,
      employee_name,
      position,
      department,
      termination_type,
      termination_reason,
      termination_date,
    } = body;

    if (
      !employee_id ||
      !employee_name ||
      !termination_type ||
      !termination_reason ||
      !termination_date
    ) {
      return withCors(req, {
        success: false,
        error:
          "employee_id, employee_name, termination_type, termination_reason, and termination_date are required.",
      }, 400);
    }

    // Validate employee
    const employee = await sql`
      SELECT *
      FROM employees
      WHERE id = ${employee_id}
      AND name = ${employee_name}
    `;

    if (!employee[0]) {
      return withCors(req, {
        success: false,
        error: `Employee ID ${employee_id} does not match name "${employee_name}"`,
      }, 400);
    }

    const result = await sql`
      INSERT INTO employee_terminations (
        employee_id,
        employee_name,
        position,
        department,
        termination_type,
        termination_reason,
        termination_date,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${employee_id},
        ${employee_name},
        ${position},
        ${department},
        ${termination_type},
        ${termination_reason},
        ${termination_date},
        'active',
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Employee terminated successfully",
      data: result[0],
    }, 201);
  } catch (error) {
    console.error("Error creating termination:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create termination.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- PUT -------------------- */
/**
 * Update termination by id
 */
export async function PUT(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<TerminationPayload>;
    const { id, employee_id, employee_name } = body;

    if (!id) {
      return withCors(req, {
        success: false,
        error: "Termination id is required.",
      }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_terminations
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, {
        success: false,
        error: "Termination not found.",
      }, 404);
    }

    // Validate employee if changed
    if (employee_id && employee_name) {
      const employee = await sql`
        SELECT *
        FROM employees
        WHERE id = ${employee_id}
        AND name = ${employee_name}
      `;

      if (!employee[0]) {
        return withCors(req, {
          success: false,
          error: `Employee ID ${employee_id} does not match name "${employee_name}"`,
        }, 400);
      }
    }

    const updated = await sql`
      UPDATE employee_terminations
      SET
        employee_id = COALESCE(${body.employee_id}, employee_id),
        employee_name = COALESCE(${body.employee_name}, employee_name),
        position = COALESCE(${body.position}, position),
        department = COALESCE(${body.department}, department),
        termination_type = COALESCE(${body.termination_type}, termination_type),
        termination_reason = COALESCE(${body.termination_reason}, termination_reason),
        termination_date = COALESCE(${body.termination_date}, termination_date),
        status = COALESCE(${body.status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Termination updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating termination:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update termination.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- DELETE -------------------- */
/**
 * Delete termination by id
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, {
        success: false,
        error: "Termination id is required for deletion.",
      }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_terminations
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, {
        success: false,
        error: "Termination not found.",
      }, 404);
    }

    await sql`
      DELETE FROM employee_terminations
      WHERE id = ${id}
    `;

    return withCors(req, {
      success: true,
      message: "Termination deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting termination:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete termination.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
