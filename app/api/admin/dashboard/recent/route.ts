import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { format } from "date-fns";
import { withCors, handleOptions } from "../../../../../lib/cors"; 

// ✅ Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ✅ Main GET request handler
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "recent";
    const limit = Number.parseInt(searchParams.get("limit") || "10", 10);

    const sql = neon(process.env.DATABASE_URL!);

    let data: any[] = [];

    // ✅ Check if tables exist before querying
    const tablesExist = await checkTablesExist(sql);

    if (tablesExist) {
      if (type === "recent") {
        // ✅ Recently registered employees
        const query = `
          SELECT 
            id, 
            CONCAT(first_name, ' ', last_name) AS name, 
            email, 
            department, 
            status, 
            created_at AS date
          FROM employees
          WHERE status != 'deleted'
          ORDER BY created_at DESC
          LIMIT $1
        `;
        const result = await sql.query(query, [limit]);

        data = result.map((row: any) => ({
          ...row,
          date: format(new Date(row.date), "MMM d, yyyy"),
        }));
      } else if (type === "pending") {
        // ✅ Pending employees
        const query = `
          SELECT 
            id, 
            CONCAT(first_name, ' ', last_name) AS name, 
            email, 
            department, 
            status, 
            created_at AS date
          FROM pending_employees
          WHERE status = 'pending_approval'
          ORDER BY created_at DESC
          LIMIT $1
        `;
        const result = await sql.query(query, [limit]);

        data = result.map((row: any) => ({
          ...row,
          date: format(new Date(row.date), "MMM d, yyyy"),
        }));
      }
    }

    return withCors(req, {
      success: true,
      data,
      source: "/admin/employees/recent",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching recent employees:", error);
    return withCors(
      req,
      {
        success: false,
        message: "Failed to fetch recent employees",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

// ✅ Helper: Check if required tables exist
async function checkTablesExist(sql: any) {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'employees'
      ) AS employees_exist,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'pending_employees'
      ) AS pending_employees_exist
    `;

    const result = await sql.query(query);

    if (!result || !result.rows) {
      console.warn("Unexpected query result format:", result);
      return false;
    }

    if (result.rows.length === 0) return false;

    const { employees_exist, pending_employees_exist } = result.rows[0];

    return employees_exist || pending_employees_exist;
  } catch (error) {
    console.error("Error checking tables:", error);
    return false;
  }
}
