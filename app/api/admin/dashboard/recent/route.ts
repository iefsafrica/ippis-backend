import { NextRequest } from "next/server";
import { authenticate } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";
import { neon } from "@neondatabase/serverless";
import { format } from "date-fns";
import { withCors, handleOptions } from "@/lib/cors"; 

// ? Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ? Main GET request handler
export async function GET(req: NextRequest) {
  try {
    // Any signed-in admin; lists only records inside the caller's scope (DSH-02)
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "recent";
    const limit = Number.parseInt(searchParams.get("limit") || "10", 10);

    const sql = neon(process.env.DATABASE_URL!);

    let data: any[] = [];

    // ? Check if tables exist before querying
    const tablesExist = await checkTablesExist(sql);

    if (tablesExist) {
      if (type === "recent") {
        // Recently registered employees inside the caller's scope
        const sc = recordScope(auth.ctx, "employees.records.view");
        const result = await sql`
          SELECT e.id, e.name, e.email, e.department, e.status, e.created_at AS date
          FROM employees e
          WHERE e.status <> 'deleted'
            AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
          ORDER BY e.created_at DESC
          LIMIT ${limit}
        `;

        data = result.map((row: any) => ({
          ...row,
          date: format(new Date(row.date), "MMM d, yyyy"),
        }));
      } else if (type === "pending") {
        // Pending registrations inside the caller's scope
        const sc = recordScope(auth.ctx, "employees.registrations.view");
        const result = await sql`
          SELECT p.id, CONCAT(p.firstname, ' ', p.surname) AS name, p.email, p.department, p.status,
                 p.created_at AS date
          FROM pending_employees p
          LEFT JOIN employment_info ei ON ei.registration_id = p.registration_id
          WHERE p.status = 'pending_approval'
            AND (${sc.all}::boolean OR ei.company_id = ANY(${sc.companyIds}::int[]) OR ei.department_id = ANY(${sc.departmentIds}::int[]))
          ORDER BY p.created_at DESC
          LIMIT ${limit}
        `;

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

// ? Helper: Check if required tables exist
async function checkTablesExist(sql: any) {
  try {
    const [row] = await sql`
      SELECT to_regclass('public.employees') IS NOT NULL AS employees_exist,
             to_regclass('public.pending_employees') IS NOT NULL AS pending_employees_exist
    `;
    return Boolean(row?.employees_exist || row?.pending_employees_exist);
  } catch (error) {
    console.error("Error checking tables:", error);
    return false;
  }
}
