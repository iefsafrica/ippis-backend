import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Warning payload
interface WarningPayload {
  id?: number;
  employee_id: string;
  employee_name?: string;
  department?: string;

  warning_subject: string;
  warning_description: string;
  warning_type: string;

  warning_date: string; // YYYY-MM-DD
  expiry_date?: string;

  issued_by: string;
  supporting_documents?: string;
  status?: string;
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
/**
 * GET all warnings
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
        AND table_name = 'employee_warnings'
      )
    `;

    if (!tableExists[0]?.exists) {
      return withCors(req, {
        success: false,
        error: "'employee_warnings' table does not exist.",
      }, 404);
    }

    let warnings;

    if (id) {
      warnings = await sql`
        SELECT *
        FROM employee_warnings
        WHERE id = ${id}
      `;
    } else if (employee_id) {
      warnings = await sql`
        SELECT *
        FROM employee_warnings
        WHERE employee_id = ${employee_id}
        ORDER BY warning_date DESC
      `;
    } else {
      warnings = await sql`
        SELECT *
        FROM employee_warnings
        ORDER BY warning_date DESC
      `;
    }

    return withCors(req, { success: true, data: warnings });
  } catch (error) {
    console.error("Error fetching warnings:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch warnings.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- POST -------------------- */
/**
 * Create new warning
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<WarningPayload>;
    const {
      employee_id,
      employee_name,
      department,
      warning_subject,
      warning_description,
      warning_type,
      warning_date,
      expiry_date,
      issued_by,
      supporting_documents,
    } = body;

    if (
      !employee_id ||
      !employee_name ||
      !warning_subject ||
      !warning_description ||
      !warning_type ||
      !warning_date ||
      !issued_by
    ) {
      return withCors(req, {
        success: false,
        error:
          "employee_id, employee_name, warning_subject, warning_description, warning_type, warning_date, and issued_by are required.",
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
      INSERT INTO employee_warnings
        (
          employee_id,
          employee_name,
          department,
          warning_subject,
          warning_description,
          warning_type,
          warning_date,
          expiry_date,
          issued_by,
          supporting_documents,
          status,
          created_at,
          updated_at
        )
      VALUES
        (
          ${employee_id},
          ${employee_name},
          ${department},
          ${warning_subject},
          ${warning_description},
          ${warning_type},
          ${warning_date},
          ${expiry_date},
          ${issued_by},
          ${supporting_documents},
          'active',
          NOW(),
          NOW()
        )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Warning issued successfully",
      data: result[0],
    }, 201);
  } catch (error) {
    console.error("Error creating warning:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create warning.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- PUT -------------------- */
/**
 * Update warning by id
 */
export async function PUT(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<WarningPayload>;
    const { id, employee_id, employee_name } = body;

    if (!id) {
      return withCors(req, {
        success: false,
        error: "Warning id is required.",
      }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_warnings
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Warning not found." }, 404);
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
      UPDATE employee_warnings
      SET
        employee_id = COALESCE(${body.employee_id}, employee_id),
        employee_name = COALESCE(${body.employee_name}, employee_name),
        department = COALESCE(${body.department}, department),
        warning_subject = COALESCE(${body.warning_subject}, warning_subject),
        warning_description = COALESCE(${body.warning_description}, warning_description),
        warning_type = COALESCE(${body.warning_type}, warning_type),
        warning_date = COALESCE(${body.warning_date}, warning_date),
        expiry_date = COALESCE(${body.expiry_date}, expiry_date),
        issued_by = COALESCE(${body.issued_by}, issued_by),
        supporting_documents = COALESCE(${body.supporting_documents}, supporting_documents),
        status = COALESCE(${body.status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Warning updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating warning:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update warning.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- DELETE -------------------- */
/**
 * Delete warning by id
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, {
        success: false,
        error: "Warning id is required for deletion.",
      }, 400);
    }

    const existing = await sql`
      SELECT *
      FROM employee_warnings
      WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Warning not found." }, 404);
    }

    await sql`
      DELETE FROM employee_warnings
      WHERE id = ${id}
    `;

    return withCors(req, {
      success: true,
      message: "Warning deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting warning:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete warning.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
