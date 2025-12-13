import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Award payload type
interface AwardPayload {
  id?: number; // for updates/deletes
  employee_id: string;
  employee_name?: string;
  department?: string;
  award_type: string;
  gift_item?: string;
  cash_prize?: number;
  award_date: string; // ISO string
  description?: string;
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET awards (all or by employee_id or by award id)
export async function GET(req: NextRequest) {
  try {
    const award_id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'employee_awards'
      )
    `;
    if (!tableExists[0]?.exists) {
      return withCors(req, { success: false, error: "'employee_awards' table does not exist." }, 404);
    }

    let awards;
    if (award_id) {
      awards = await sql`SELECT * FROM employee_awards WHERE id = ${award_id}`;
    } else if (employee_id) {
      awards = await sql`
        SELECT *
        FROM employee_awards
        WHERE employee_id = ${employee_id}
        ORDER BY award_date DESC
      `;
    } else {
      awards = await sql`
        SELECT *
        FROM employee_awards
        ORDER BY award_date DESC
      `;
    }

    return withCors(req, { success: true, data: awards });
  } catch (error) {
    console.error("Error fetching awards:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch awards.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// POST new award with employee validation
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<AwardPayload>;
    const {
      employee_id,
      employee_name,
      department,
      award_type,
      gift_item,
      cash_prize,
      award_date,
      description,
    } = body;

    if (!employee_id || !award_type || !award_date || !employee_name) {
      return withCors(req, { success: false, error: "employee_id, employee_name, award_type, and award_date are required." }, 400);
    }

    // Validate employee_id matches employee_name
    const employee = await sql`
      SELECT * FROM employees WHERE id = ${employee_id} AND name = ${employee_name}
    `;

    if (!employee[0]) {
      return withCors(req, {
        success: false,
        error: `Employee ID ${employee_id} does not match name "${employee_name}"`,
      }, 400);
    }

    // Insert new award
    const result = await sql`
      INSERT INTO employee_awards
        (employee_id, employee_name, department, award_type, gift_item, cash_prize, award_date, description, status, created_at, updated_at)
      VALUES
        (${employee_id}, ${employee_name}, ${department}, ${award_type}, ${gift_item}, ${cash_prize || 0}, ${award_date}, ${description}, 'active', NOW(), NOW())
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Award created successfully", data: result[0] }, 201);
  } catch (error) {
    console.error("Error creating award:", error);
    return withCors(req, { success: false, error: "Failed to create award.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// PUT to update an award by id with employee validation
export async function PUT(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<AwardPayload>;
    const { id, employee_id, employee_name } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Award id is required for update." }, 400);
    }

    const existing = await sql`SELECT * FROM employee_awards WHERE id = ${id}`;
    if (!existing[0]) {
      return withCors(req, { success: false, error: "Award not found." }, 404);
    }

    // Validate employee_id matches employee_name if both provided
    if (employee_id && employee_name) {
      const employee = await sql`
        SELECT * FROM employees WHERE id = ${employee_id} AND name = ${employee_name}
      `;
      if (!employee[0]) {
        return withCors(req, {
          success: false,
          error: `Employee ID ${employee_id} does not match name "${employee_name}"`,
        }, 400);
      }
    }

    const updated = await sql`
      UPDATE employee_awards
      SET
        employee_id = COALESCE(${body.employee_id}, employee_id),
        employee_name = COALESCE(${body.employee_name}, employee_name),
        department = COALESCE(${body.department}, department),
        award_type = COALESCE(${body.award_type}, award_type),
        gift_item = COALESCE(${body.gift_item}, gift_item),
        cash_prize = COALESCE(${body.cash_prize}, cash_prize),
        award_date = COALESCE(${body.award_date}, award_date),
        description = COALESCE(${body.description}, description),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Award updated successfully", data: updated[0] });
  } catch (error) {
    console.error("Error updating award:", error);
    return withCors(req, { success: false, error: "Failed to update award.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// DELETE an award by id
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return withCors(req, { success: false, error: "Award id is required for deletion." }, 400);
    }

    const existing = await sql`SELECT * FROM employee_awards WHERE id = ${id}`;
    if (!existing[0]) {
      return withCors(req, { success: false, error: "Award not found." }, 404);
    }

    await sql`DELETE FROM employee_awards WHERE id = ${id}`;

    return withCors(req, { success: true, message: "Award deleted successfully" });
  } catch (error) {
    console.error("Error deleting award:", error);
    return withCors(req, { success: false, error: "Failed to delete award.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}
