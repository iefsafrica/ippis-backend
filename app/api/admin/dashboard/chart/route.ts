import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export async function GET() {
  try {
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
  FROM employees
  WHERE created_at >= ${startDate} AND created_at <= ${endDate};
`;
employeeData.push(Number(employeeResult[0]?.count || 0));


        // Get pending registrations for this month
const pendingResult = await sql`
  SELECT COUNT(*) as count
  FROM pending_employees
  WHERE created_at >= ${startDate} AND created_at <= ${endDate};
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
    const query = `
      SELECT 
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'employees'
        ) as employees_exist,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'pending_employees'
        ) as pending_employees_exist
    `;

    const result = await sql(query);

    if (!Array.isArray(result) || result.length === 0) {
      console.warn("Unexpected query result format:", result);
      return false;
    }

    const { employees_exist, pending_employees_exist } = result[0];
    return employees_exist || pending_employees_exist;
  } catch (error) {
    console.error("Error checking tables:", error);
    return false;
  }
}
