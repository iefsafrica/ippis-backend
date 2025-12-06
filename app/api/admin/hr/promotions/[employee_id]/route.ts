import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET employee details by ID
export async function GET(req: NextRequest) {
  try {
    const { employee_id } = req.nextUrl.pathname.split("/").slice(-1)[0] 
      ? { employee_id: req.nextUrl.pathname.split("/").slice(-1)[0] } 
      : {};

    if (!employee_id) {
      return withCors(
        req,
        { success: false, error: "Missing employee_id in URL." },
        400
      );
    }

    // Check table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'employees'
      )
    `;

    if (!tableExists[0]?.exists) {
      return withCors(req, { success: false, error: "'employees' table does not exist." }, 404);
    }

    // Fetch employee
    const employee = await sql`
      SELECT *
      FROM employees
      WHERE id = ${employee_id}
    `;

    if (!employee[0]) {
      return withCors(req, { success: false, error: "Employee not found." }, 404);
    }

    // Fetch promotions
    const promotions = await sql`
      SELECT *
      FROM employee_promotions
      WHERE employee_id = ${employee_id}
      ORDER BY effective_date DESC
    `;

    return withCors(req, {
      success: true,
      data: {
        ...employee[0],
        promotions,
      },
    });
  } catch (error) {
    console.error("Error fetching employee:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch employee details.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
