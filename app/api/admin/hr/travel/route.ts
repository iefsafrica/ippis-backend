import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Travel payload type
interface TravelPayload {
  id?: number; // for updates/deletes
  employee_id: string;
  employee_name: string;
  department?: string;
  purpose: string;
  start_date: string; // ISO string
  end_date?: string;  // ISO string
  destination?: string;
  travel_mode?: string;
  accommodation?: string;
  estimated_cost?: number;
  advance_amount?: number;
  status?: string;
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET travel records (all, by id, or by employee_id)
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'employee_travel'
      )
    `;
    if (!tableExists[0]?.exists) {
      return withCors(req, { success: false, error: "'employee_travel' table does not exist." }, 404);
    }

    let records;
    if (id) {
      records = await sql`SELECT * FROM employee_travel WHERE id = ${id}`;
    } else if (employee_id) {
      records = await sql`
        SELECT *
        FROM employee_travel
        WHERE employee_id = ${employee_id}
        ORDER BY start_date DESC
      `;
    } else {
      records = await sql`
        SELECT *
        FROM employee_travel
        ORDER BY start_date DESC
      `;
    }

    return withCors(req, { success: true, data: records });
  } catch (error) {
    console.error("Error fetching travel records:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch travel records.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// POST new travel record with employee validation
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) return withCors(req, { success: false, error: "Request body is empty" }, 400);

    const body = JSON.parse(rawBody) as Partial<TravelPayload>;
    const { employee_id, employee_name, purpose, start_date } = body;

    if (!employee_id || !employee_name || !purpose || !start_date) {
      return withCors(req, { success: false, error: "employee_id, employee_name, purpose, and start_date are required." }, 400);
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

    const result = await sql`
      INSERT INTO employee_travel
        (employee_id, employee_name, department, purpose, start_date, end_date, destination, travel_mode, accommodation, estimated_cost, advance_amount, status, created_at, updated_at)
      VALUES
        (${employee_id}, ${employee_name}, ${body.department}, ${purpose}, ${start_date}, ${body.end_date}, ${body.destination}, ${body.travel_mode}, ${body.accommodation}, ${body.estimated_cost || 0}, ${body.advance_amount || 0}, ${body.status || 'pending'}, NOW(), NOW())
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Travel record created successfully", data: result[0] }, 201);
  } catch (error) {
    console.error("Error creating travel record:", error);
    return withCors(req, { success: false, error: "Failed to create travel record.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// PUT update travel record by id with employee validation
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TravelPayload>;
    const { id, employee_id, employee_name } = body;

    if (!id) return withCors(req, { success: false, error: "Travel id is required for update." }, 400);

    const existing = await sql`SELECT * FROM employee_travel WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Travel record not found." }, 404);

    // Validate employee_id matches employee_name if either is being updated
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
      UPDATE employee_travel
      SET
        employee_id = COALESCE(${employee_id}, employee_id),
        employee_name = COALESCE(${employee_name}, employee_name),
        department = COALESCE(${body.department}, department),
        purpose = COALESCE(${body.purpose}, purpose),
        start_date = COALESCE(${body.start_date}, start_date),
        end_date = COALESCE(${body.end_date}, end_date),
        destination = COALESCE(${body.destination}, destination),
        travel_mode = COALESCE(${body.travel_mode}, travel_mode),
        accommodation = COALESCE(${body.accommodation}, accommodation),
        estimated_cost = COALESCE(${body.estimated_cost}, estimated_cost),
        advance_amount = COALESCE(${body.advance_amount}, advance_amount),
        status = COALESCE(${body.status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Travel record updated successfully", data: updated[0] });
  } catch (error) {
    console.error("Error updating travel record:", error);
    return withCors(req, { success: false, error: "Failed to update travel record.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// DELETE a travel record by id
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return withCors(req, { success: false, error: "Travel id is required for deletion." }, 400);

    const existing = await sql`SELECT * FROM employee_travel WHERE id = ${id}`;
    if (!existing[0]) return withCors(req, { success: false, error: "Travel record not found." }, 404);

    await sql`DELETE FROM employee_travel WHERE id = ${id}`;

    return withCors(req, { success: true, message: "Travel record deleted successfully" });
  } catch (error) {
    console.error("Error deleting travel record:", error);
    return withCors(req, { success: false, error: "Failed to delete travel record.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}
