import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Complaint payload
interface ComplaintPayload {
  id?: number;
  employee_id: string;
  employee_name?: string;
  complaint: string;
  department?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  submitted_on?: string; // ISO string
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
/**
 * GET all complaints
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
        AND table_name = 'employee_complaints'
      )
    `;

    if (!tableExists[0]?.exists) {
      return withCors(req, {
        success: false,
        error: "'employee_complaints' table does not exist.",
      }, 404);
    }

    let complaints;

    if (id) {
      complaints = await sql`
        SELECT *
        FROM employee_complaints
        WHERE id = ${id}
      `;
    } else if (employee_id) {
      complaints = await sql`
        SELECT *
        FROM employee_complaints
        WHERE employee_id = ${employee_id}
        ORDER BY submitted_on DESC
      `;
    } else {
      complaints = await sql`
        SELECT *
        FROM employee_complaints
        ORDER BY submitted_on DESC
      `;
    }

    return withCors(req, { success: true, data: complaints });
  } catch (error) {
    console.error("Error fetching complaints:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch complaints.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- POST -------------------- */
/**
 * Create new complaint
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<ComplaintPayload>;
    const {
      employee_id,
      employee_name,
      complaint,
      department,
      priority,
      assigned_to,
    } = body;

    if (!employee_id || !employee_name || !complaint) {
      return withCors(req, {
        success: false,
        error: "employee_id, employee_name, and complaint are required.",
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
      INSERT INTO employee_complaints
        (
          employee_id,
          employee_name,
          complaint,
          department,
          priority,
          assigned_to,
          status,
          submitted_on,
          created_at,
          updated_at
        )
      VALUES
        (
          ${employee_id},
          ${employee_name},
          ${complaint},
          ${department},
          ${priority || "medium"},
          ${assigned_to},
          'pending',
          NOW(),
          NOW(),
          NOW()
        )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Complaint submitted successfully",
      data: result[0],
    }, 201);
  } catch (error) {
    console.error("Error creating complaint:", error);
    return withCors(req, {
      success: false,
      error: "Failed to submit complaint.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- PUT -------------------- */
/**
 * Update complaint by id
 */
export async function PUT(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<ComplaintPayload>;
    const { id, employee_id, employee_name } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Complaint id is required." }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_complaints
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Complaint not found." }, 404);
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
      UPDATE employee_complaints
      SET
        employee_id = COALESCE(${body.employee_id}, employee_id),
        employee_name = COALESCE(${body.employee_name}, employee_name),
        complaint = COALESCE(${body.complaint}, complaint),
        department = COALESCE(${body.department}, department),
        status = COALESCE(${body.status}, status),
        priority = COALESCE(${body.priority}, priority),
        assigned_to = COALESCE(${body.assigned_to}, assigned_to),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Complaint updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating complaint:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update complaint.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- DELETE -------------------- */
/**
 * Delete complaint by id
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, {
        success: false,
        error: "Complaint id is required for deletion.",
      }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_complaints
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Complaint not found." }, 404);
    }

    await sql`
      DELETE FROM employee_complaints
      WHERE id = ${id}
    `;

    return withCors(req, {
      success: true,
      message: "Complaint deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting complaint:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete complaint.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
