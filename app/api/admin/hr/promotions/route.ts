import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Create Neon client
const sql = neon(process.env.DATABASE_URL!);

// Helper: check if a table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error);
    return false;
  }
}

// Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// POST: Add a new employee promotion
export async function POST(req: NextRequest) {
  try {
    // Safe JSON parsing
    let body: {
      employee_id?: string;
      previous_position?: string;
      new_position?: string;
      effective_date?: string;
      reason?: string;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return withCors(
        req,
        {
          success: false,
          error: "Invalid or empty JSON body. Please send valid JSON with Content-Type: application/json.",
        },
        400
      );
    }

    const { employee_id, previous_position, new_position, effective_date, reason } = body;

    // Validate required fields
    if (!employee_id || !previous_position || !new_position || !effective_date) {
      return withCors(
        req,
        {
          success: false,
          error: "Missing required fields: employee_id, previous_position, new_position, effective_date.",
        },
        400
      );
    }

    // Ensure promotions table exists
    const exists = await tableExists("employee_promotions");
    if (!exists) {
      return withCors(
        req,
        {
          success: false,
          error: "The 'employee_promotions' table does not exist in the database.",
        },
        404
      );
    }

    // Insert promotion
    const inserted = await sql`
      INSERT INTO employee_promotions
        (employee_id, previous_position, new_position, effective_date, reason, created_at, updated_at)
      VALUES
        (${employee_id}, ${previous_position}, ${new_position}, ${effective_date}, ${reason ?? null}, NOW(), NOW())
      RETURNING *
    `;

    const promotion = inserted[0];

    return withCors(req, {
      success: true,
      message: "Employee promotion added successfully.",
      data: promotion,
    });
  } catch (error) {
    console.error("Error adding employee promotion:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to add employee promotion.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
