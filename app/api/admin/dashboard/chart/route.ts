import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";
import { neon } from "@neondatabase/serverless";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export async function GET(req: NextRequest) {
  try {
    // Any signed-in admin; counts only records inside the caller's scope (DSH-02)
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const scE = recordScope(auth.ctx, "employees.records.view");
    const scR = recordScope(auth.ctx, "employees.registrations.view");

    const sql = neon(process.env.DATABASE_URL!);

    // Generate labels for the last 6 months
    const today = new Date();
    const labels: string[] = [];
    const employeeData: number[] = [];
    const pendingData: number[] = [];

    // Check if tables exist before querying
    const tablesExist = await checkTablesExist(sql);

    if (tablesExist) {
      // Get data for the last 6 months
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(today, i);
        const monthLabel = format(monthDate, "MMM");
        labels.push(monthLabel);

        const startDate = format(startOfMonth(monthDate), "yyyy-MM-dd");
        const endDate = format(endOfMonth(monthDate), "yyyy-MM-dd");

        // Get employee registrations for this month
        const employeeResult = await sql`
  SELECT COUNT(*) as count
  FROM employees e
  WHERE e.created_at >= ${startDate} AND e.created_at <= ${endDate}
    AND (${scE.all}::boolean OR e.company_id = ANY(${scE.companyIds}::int[]) OR e.department_id = ANY(${scE.departmentIds}::int[]));
`;
employeeData.push(Number(employeeResult[0]?.count || 0));


        // Get pending registrations for this month
const pendingResult = await sql`
  SELECT COUNT(*) as count
  FROM pending_employees p
  LEFT JOIN employment_info ei ON ei.registration_id = p.registration_id
  WHERE p.created_at >= ${startDate} AND p.created_at <= ${endDate}
    AND (${scR.all}::boolean OR ei.company_id = ANY(${scR.companyIds}::int[]) OR ei.department_id = ANY(${scR.departmentIds}::int[]));
`;
pendingData.push(Number(pendingResult[0]?.count || 0));

      }
    } else {
      // If tables don't exist, use empty data
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(today, i);
        const monthLabel = format(monthDate, "MMM");
        labels.push(monthLabel);
        employeeData.push(0);
        pendingData.push(0);
      }
    }

    const chartData = {
      labels,
      datasets: [
        {
          label: "Approved Employees",
          data: employeeData,
        },
        {
          label: "Pending Registrations",
          data: pendingData,
        },
      ],
    };

    return NextResponse.json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    console.error("Error fetching chart data:", error);

    // Return default data instead of an error
    const today = new Date();
    const labels: string[] = [];

    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(today, i);
      const monthLabel = format(monthDate, "MMM");
      labels.push(monthLabel);
    }

    return NextResponse.json({
      success: true,
      data: {
        labels,
        datasets: [
          {
            label: "Registrations",
            data: [0, 0, 0, 0, 0, 0],
          },
        ],
      },
      message: "Using default data due to an error",
    });
  }
}

// Helper function to check if required tables exist
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
