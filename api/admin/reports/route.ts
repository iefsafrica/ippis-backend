import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { format, subMonths } from "date-fns"

// Initialize the database connection
const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "overview"
    const startDate = searchParams.get("startDate") || format(subMonths(new Date(), 12), "yyyy-MM-dd")
    const endDate = searchParams.get("endDate") || format(new Date(), "yyyy-MM-dd")
    const department = searchParams.get("department") || "all"

    let result

    // Department filter for queries
    const deptFilter = department !== "all" ? `AND department = '${department}'` : ""

    switch (reportType) {
      case "overview":
        // Get overview statistics
        const totalEmployeesQuery = `
          SELECT COUNT(*) as count 
          FROM employees 
          WHERE status != 'deleted'
        `

        const activeEmployeesQuery = `
          SELECT COUNT(*) as count 
          FROM employees 
          WHERE status = 'active'
        `

        const pendingApprovalsQuery = `
          SELECT COUNT(*) as count 
          FROM registrations 
          WHERE status = 'pending_approval'
        `

        const documentSubmissionsQuery = `
          SELECT COUNT(*) as count 
          FROM document_uploads 
          WHERE upload_date BETWEEN '${startDate}' AND '${endDate}'
        `

        const approvalRateQuery = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
          FROM registrations
          WHERE status IN ('approved', 'rejected')
            AND created_at BETWEEN '${startDate}' AND '${endDate}'
        `

        const growthRateQuery = `
          WITH current_period AS (
            SELECT COUNT(*) as count
            FROM employees
            WHERE join_date BETWEEN '${startDate}' AND '${endDate}'
          ),
          previous_period AS (
            SELECT COUNT(*) as count
            FROM employees
            WHERE join_date BETWEEN 
              DATE('${startDate}') - INTERVAL '1 year' AND 
              DATE('${endDate}') - INTERVAL '1 year'
          )
          SELECT 
            current_period.count as current_count,
            previous_period.count as previous_count,
            CASE 
              WHEN previous_period.count = 0 THEN 100
              ELSE ((current_period.count - previous_period.count) / previous_period.count) * 100
            END as growth_rate
          FROM current_period, previous_period
        `

        const departmentDistributionQuery = `
          SELECT 
            department,
            COUNT(*) as count
          FROM employees
          WHERE status = 'active' ${deptFilter}
          GROUP BY department
          ORDER BY count DESC
        `

        const [
          totalEmployeesResult,
          activeEmployeesResult,
          pendingApprovalsResult,
          documentSubmissionsResult,
          approvalRateResult,
          growthRateResult,
          departmentDistributionResult,
        ] = await Promise.all([
          sql(totalEmployeesQuery),
          sql(activeEmployeesQuery),
          sql(pendingApprovalsQuery),
          sql(documentSubmissionsQuery),
          sql(approvalRateQuery),
          sql(growthRateQuery),
          sql(departmentDistributionQuery),
        ])

        const approvalRate =
          approvalRateResult[0]?.total > 0 ? (approvalRateResult[0].approved / approvalRateResult[0].total) * 100 : 0

        result = {
          totalEmployees: Number(totalEmployeesResult[0]?.count || 0),
          activeEmployees: Number(activeEmployeesResult[0]?.count || 0),
          pendingApprovals: Number(pendingApprovalsResult[0]?.count || 0),
          documentSubmissions: Number(documentSubmissionsResult[0]?.count || 0),
          growthRate: Number(growthRateResult[0]?.growth_rate?.toFixed(2) || 0),
          approvalRate: Number(approvalRate.toFixed(2)),
          departmentDistribution: departmentDistributionResult.map((row) => ({
            name: row.department,
            count: Number(row.count),
            percentage: Number(((Number(row.count) / Number(totalEmployeesResult[0]?.count || 1)) * 100).toFixed(2)),
          })),
        }
        break

      case "employeeGrowth":
        // Get employee growth data for the past 12 months
        const employeeGrowthQuery = `
          WITH months AS (
            SELECT generate_series(
              date_trunc('month', DATE '${startDate}'),
              date_trunc('month', DATE '${endDate}'),
              interval '1 month'
            ) as month
          )
          SELECT 
            to_char(months.month, 'Mon YYYY') as month_label,
            COALESCE(COUNT(e.id), 0) as new_employees,
            COALESCE(SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END), 0) as active_employees
          FROM months
          LEFT JOIN employees e ON 
            date_trunc('month', e.join_date) = months.month
            ${deptFilter}
          GROUP BY months.month
          ORDER BY months.month
        `

        const employeeGrowthResult = await sql(employeeGrowthQuery)

        result = {
          labels: employeeGrowthResult.map((row) => row.month_label),
          datasets: [
            {
              label: "New Employees",
              data: employeeGrowthResult.map((row) => Number(row.new_employees)),
            },
            {
              label: "Active Employees",
              data: employeeGrowthResult.map((row) => Number(row.active_employees)),
            },
          ],
        }
        break

      case "departments":
        // Get department statistics
        const departmentsQuery = `
          SELECT 
            e.department,
            COUNT(*) as total,
            SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN e.status = 'inactive' THEN 1 ELSE 0 END) as inactive
          FROM employees e
          WHERE e.status != 'deleted' ${deptFilter}
          GROUP BY e.department
          ORDER BY total DESC
        `

        const departmentsResult = await sql(departmentsQuery)

        result = {
          departments: departmentsResult.map((row) => ({
            name: row.department,
            total: Number(row.total),
            active: Number(row.active),
            inactive: Number(row.inactive),
            percentage: 0, // Will be calculated in the frontend
          })),
        }
        break

      case "payroll":
        // Get payroll statistics
        const payrollQuery = `
          SELECT 
            SUM(salary) as total_salary,
            AVG(salary) as average_salary,
            department,
            SUM(salary) as department_total
          FROM employees
          WHERE status = 'active' ${deptFilter}
          GROUP BY department
          ORDER BY department_total DESC
        `

        const payrollResult = await sql(payrollQuery)

        const totalSalary = payrollResult.reduce((sum, row) => sum + Number(row.department_total), 0)

        result = {
          totalSalary,
          averageSalary: Number(payrollResult[0]?.average_salary || 0),
          departmentBreakdown: payrollResult.map((row) => ({
            department: row.department,
            amount: Number(row.department_total),
            percentage: Number(((Number(row.department_total) / totalSalary) * 100).toFixed(2)),
          })),
        }
        break

      default:
        return NextResponse.json(
          {
            error: "Invalid report type",
          },
          { status: 400 },
        )
    }

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error("Reports error:", error)
    return NextResponse.json(
      {
        error: "Failed to generate report",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
