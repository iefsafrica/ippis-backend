import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

interface ResignationPayload {
  id?: number;

  employee_id: string;
  employee_name: string;
  department: string;
  position: string;

  notice_date: string;
  resignation_date: string;

  reason: string;
  exit_interview: string;
  notes?: string;

  status?: string;
}

// CORS
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET (all / by id / by employee)
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    let records;
    if (id) {
      records = await sql`SELECT * FROM employee_resignations WHERE id = ${id}`;
    } else if (employee_id) {
      records = await sql`
        SELECT * FROM employee_resignations
        WHERE employee_id = ${employee_id}
        ORDER BY created_at DESC
      `;
    } else {
      records = await sql`
        SELECT * FROM employee_resignations
        ORDER BY created_at DESC
      `;
    }

    return withCors(req, { success: true, data: records });
  } catch (error) {
    console.error("Fetch resignations error:", error);
    return withCors(req, { success: false, error: "Failed to fetch resignations." }, 500);
  }
}

// POST – Create resignation
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ResignationPayload>;

    const required = [
      "employee_id",
      "employee_name",
      "department",
      "position",
      "notice_date",
      "resignation_date",
      "reason",
      "exit_interview"
    ];

    for (const field of required) {
      if (!(body as any)[field]) {
        return withCors(req, {
          success: false,
          error: `${field} is required.`,
        }, 400);
      }
    }

    // Validate employee
    const employee = await sql`
      SELECT * FROM employees
      WHERE id = ${body.employee_id}
      AND name = ${body.employee_name}
    `;
    if (!employee[0]) {
      return withCors(req, {
        success: false,
        error: "Employee ID does not match employee name.",
      }, 400);
    }

    const result = await sql`
      INSERT INTO employee_resignations (
        employee_id,
        employee_name,
        department,
        position,
        notice_date,
        resignation_date,
        reason,
        exit_interview,
        notes,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${body.employee_id},
        ${body.employee_name},
        ${body.department},
        ${body.position},
        ${body.notice_date},
        ${body.resignation_date},
        ${body.reason},
        ${body.exit_interview},
        ${body.notes},
        ${body.status || "pending"},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Employee resignation created successfully",
      data: result[0],
    }, 201);
  } catch (error) {
    console.error("Create resignation error:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create resignation.",
    }, 500);
  }
}

// PUT – Update (pending only)
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ResignationPayload>;

    if (!body.id) {
      return withCors(req, { success: false, error: "Resignation id is required." }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_resignations WHERE id = ${body.id}
    `;
    if (!existing[0]) {
      return withCors(req, { success: false, error: "Resignation not found." }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending resignations can be updated.",
      }, 400);
    }

    const updated = await sql`
      UPDATE employee_resignations
      SET
        department = COALESCE(${body.department}, department),
        position = COALESCE(${body.position}, position),
        notice_date = COALESCE(${body.notice_date}, notice_date),
        resignation_date = COALESCE(${body.resignation_date}, resignation_date),
        reason = COALESCE(${body.reason}, reason),
        exit_interview = COALESCE(${body.exit_interview}, exit_interview),
        notes = COALESCE(${body.notes}, notes),
        updated_at = NOW()
      WHERE id = ${body.id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Resignation updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Update resignation error:", error);
    return withCors(req, { success: false, error: "Failed to update resignation." }, 500);
  }
}

// DELETE – Pending only
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "Resignation id is required." }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_resignations WHERE id = ${id}
    `;
    if (!existing[0]) {
      return withCors(req, { success: false, error: "Resignation not found." }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending resignations can be deleted.",
      }, 400);
    }

    await sql`DELETE FROM employee_resignations WHERE id = ${id}`;

    return withCors(req, {
      success: true,
      message: "Resignation deleted successfully",
    });
  } catch (error) {
    console.error("Delete resignation error:", error);
    return withCors(req, { success: false, error: "Failed to delete resignation." }, 500);
  }
}
