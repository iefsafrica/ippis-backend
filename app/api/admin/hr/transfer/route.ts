import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Transfer payload type
interface TransferPayload {
  id?: number;

  employee_id: string;
  employee_name: string;

  from_department?: string;
  to_department?: string;

  from_position?: string;
  to_position?: string;

  from_location?: string;
  to_location?: string;

  effective_date: string; // ISO
  reason?: string;

  status?: string;
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET transfers (all, by id, or by employee_id)
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'employee_transfers'
      )
    `;

    if (!tableExists[0]?.exists) {
      return withCors(req, {
        success: false,
        error: "'employee_transfers' table does not exist.",
      }, 404);
    }

    let records;

    if (id) {
      records = await sql`
        SELECT * FROM employee_transfers WHERE id = ${id}
      `;
    } else if (employee_id) {
      records = await sql`
        SELECT *
        FROM employee_transfers
        WHERE employee_id = ${employee_id}
        ORDER BY created_at DESC
      `;
    } else {
      records = await sql`
        SELECT *
        FROM employee_transfers
        ORDER BY created_at DESC
      `;
    }

    return withCors(req, { success: true, data: records });
  } catch (error) {
    console.error("Error fetching transfer records:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch transfer records.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// POST new transfer (with employee validation)
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return withCors(req, { success: false, error: "Request body is empty" }, 400);
    }

    const body = JSON.parse(rawBody) as Partial<TransferPayload>;
    const { employee_id, employee_name, effective_date } = body;

    if (!employee_id || !employee_name || !effective_date) {
      return withCors(req, {
        success: false,
        error: "employee_id, employee_name and effective_date are required.",
      }, 400);
    }

    // Validate employee
    const employee = await sql`
      SELECT * FROM employees
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
      INSERT INTO employee_transfers (
        employee_id,
        employee_name,
        from_department,
        to_department,
        from_position,
        to_position,
        from_location,
        to_location,
        effective_date,
        reason,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${employee_id},
        ${employee_name},
        ${body.from_department},
        ${body.to_department},
        ${body.from_position},
        ${body.to_position},
        ${body.from_location},
        ${body.to_location},
        ${effective_date},
        ${body.reason},
        ${body.status || "pending"},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Employee transfer created successfully",
      data: result[0],
    }, 201);
  } catch (error) {
    console.error("Error creating transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// PUT update transfer (pending only)
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TransferPayload>;
    const { id } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Transfer id is required." }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_transfers WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Transfer not found." }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending transfers can be updated.",
      }, 400);
    }

    const updated = await sql`
      UPDATE employee_transfers
      SET
        from_department = COALESCE(${body.from_department}, from_department),
        to_department   = COALESCE(${body.to_department}, to_department),
        from_position   = COALESCE(${body.from_position}, from_position),
        to_position     = COALESCE(${body.to_position}, to_position),
        from_location   = COALESCE(${body.from_location}, from_location),
        to_location     = COALESCE(${body.to_location}, to_location),
        effective_date  = COALESCE(${body.effective_date}, effective_date),
        reason          = COALESCE(${body.reason}, reason),
        updated_at      = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Transfer updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// DELETE transfer (pending only)
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "Transfer id is required." }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_transfers WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Transfer not found." }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending transfers can be deleted.",
      }, 400);
    }

    await sql`DELETE FROM employee_transfers WHERE id = ${id}`;

    return withCors(req, {
      success: true,
      message: "Transfer deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
