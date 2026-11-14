import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { keepInScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { sendTerminationEmail } from "@/lib/email";

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
    const auth = await requirePermission(req, "corehr.records.view");
    if (!auth.ok) return auth.response;

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

    // Only the records of employees inside the caller's MDA or department
    terminations = await keepInScope(auth.ctx, "corehr.records.view", terminations);
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
    const auth = await requirePermission(req, "corehr.records.manage");
    if (!auth.ok) return auth.response;

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
    if (!(await employeeInScope(auth.ctx, "corehr.records.manage", employee[0].id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
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

    await runAudited(req, auth.ctx, { action: "corehr.termination.created", targetType: "corehr.termination", details: {} }, []);

    // Update the employee's status in nominal roll
    await sql`
      UPDATE employees
      SET status = 'terminated', updated_at = NOW()
      WHERE id = ${employee_id}
    `;

    // Fetch employee contact and MDA for official email dispatch
    let emailSent = false;
    const empDetails = await sql`
      SELECT e.email, e.name, c.name AS mda_name, p.email AS p_email
      FROM employees e
      LEFT JOIN companies c ON c.id = e.company_id
      LEFT JOIN personal_info p ON (p.registration_id = e.registration_id OR p.registration_id = e.id)
      WHERE e.id = ${employee_id}
      LIMIT 1
    `;

    const targetEmail = empDetails[0]?.email || empDetails[0]?.p_email;
    if (targetEmail) {
      sendTerminationEmail({
        to: targetEmail,
        fullName: employee_name || empDetails[0]?.name || "Civil Service Officer",
        employeeId: employee_id,
        position: position || undefined,
        department: department || undefined,
        mdaName: empDetails[0]?.mda_name || undefined,
        terminationType: termination_type,
        terminationReason: termination_reason,
        terminationDate: termination_date,
      }).catch((err) => {
        console.error("Termination email dispatch failed:", err);
      });
      emailSent = true;
    }

    return withCors(req, {
      success: true,
      message: "Employee terminated successfully and disengagement notification queued",
      data: result[0],
      emailSent,
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
    const auth = await requirePermission(req, "corehr.records.manage");
    if (!auth.ok) return auth.response;

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
    if (!(await employeeInScope(auth.ctx, "corehr.records.manage", existing[0].employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }
    // The record may only be moved to another employee inside the caller's scope
    if (body.employee_id && !(await employeeInScope(auth.ctx, "corehr.records.manage", body.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
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

    await runAudited(req, auth.ctx, { action: "corehr.termination.updated", targetType: "corehr.termination", details: {} }, []);

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
    const auth = await requirePermission(req, "corehr.records.manage");
    if (!auth.ok) return auth.response;

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
    if (!(await employeeInScope(auth.ctx, "corehr.records.manage", existing[0].employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    await sql`
      DELETE FROM employee_terminations
      WHERE id = ${id}
    `;

    await runAudited(req, auth.ctx, { action: "corehr.termination.deleted", targetType: "corehr.termination", details: {} }, []);

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
