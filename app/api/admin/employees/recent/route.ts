import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Create Neon client
const sql = neon(process.env.DATABASE_URL!);

// Helper: check if table exists
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

// Helper: format date fields safely
function formatDateFields(rows: any[]) {
  return rows.map((row) => {
    const formattedRow = { ...row };
    const formatDate = (field: string, newField?: string) => {
      if (!formattedRow[field]) return;
      try {
        const date = new Date(formattedRow[field]);
        if (isNaN(date.getTime())) {
          formattedRow[field] = null;
          if (newField) formattedRow[newField] = null;
        } else if (newField) {
          formattedRow[newField] = date.toISOString();
        }
      } catch {
        formattedRow[field] = null;
        if (newField) formattedRow[newField] = null;
      }
    };

    formatDate("created_at", "createdAt");
    formatDate("updated_at", "updatedAt");

    return formattedRow;
  });
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET: Fetch 10 latest active employees
export async function GET(req: NextRequest) {
  try {
    console.log("Fetching 10 latest active employees...");

    // Ensure table exists
    const exists = await tableExists("employees");
    if (!exists) {
      return withCors(
        req,
        {
          success: false,
          error: "The 'employees' table does not exist in the database.",
        },
        404
      );
    }

    // Fetch 10 most recently added active employees
    const rows = await sql`
      SELECT * 
      FROM employees
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const formattedRows = formatDateFields(rows);

    return withCors(req, {
      success: true,
      data: {
        employees: formattedRows,
        count: formattedRows.length,
      },
    });
  } catch (error) {
    console.error("Error fetching active employees:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch active employees from database.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
