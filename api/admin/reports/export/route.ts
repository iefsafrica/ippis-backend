import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { format, subMonths } from "date-fns"

// Initialize the database connection
const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "overview"
    const exportFormat = searchParams.get("format") || "json"
    const startDate = searchParams.get("startDate") || format(subMonths(new Date(), 12), "yyyy-MM-dd")
    const endDate = searchParams.get("endDate") || format(new Date(), "yyyy-MM-dd")
    const department = searchParams.get("department") || "all"

    // Department filter for queries
    const deptFilter = department !== "all" ? `AND department = '${department}'` : ""

    let data
    let filename = `ippis-${reportType}-report-${format(new Date(), "yyyy-MM-dd")}`

    switch (reportType) {
      case "overview":
        const overviewQuery = `
          WITH employee_counts AS (
            SELECT 
              COUNT(*) as total_employees,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_employees
            FROM employees
            WHERE status != 'deleted'
          ),
          pending_counts AS (
            SELECT COUNT(*) as pending_approvals
            FROM registrations
            WHERE status = 'pending_approval'
          ),
          document_counts AS (
            SELECT COUNT(*) as document_submissions
            FROM document_uploads
            WHERE upload_date BETWEEN '${startDate}' AND '${endDate}'
          ),
          department_stats AS (
            SELECT 
              department,
              COUNT(*) as count
            FROM employees
            WHERE status = 'active' ${deptFilter}
            GROUP BY department
            ORDER BY count DESC
          )
          SELECT 
            e.total_employees,
            e.active_employees,
            p.pending_approvals,
            d.document_submissions,
            json_agg(
              json_build_object(
                'department', ds.department,
                'count', ds.count
              )
            ) as department_distribution
          FROM 
            employee_counts e,
            pending_counts p,
            document_counts d,
            department_stats ds
          GROUP BY e.total_employees, e.active_employees, p.pending_approvals, d.document_submissions
        `

        const overviewResult = await sql(overviewQuery)

        data = {
          reportType: "Overview Report",
          generatedAt: new Date().toISOString(),
          dateRange: {
            from: startDate,
            to: endDate,
          },
          statistics: {
            totalEmployees: Number(overviewResult[0]?.total_employees || 0),
            activeEmployees: Number(overviewResult[0]?.active_employees || 0),
            pendingApprovals: Number(overviewResult[0]?.pending_approvals || 0),
            documentSubmissions: Number(overviewResult[0]?.document_submissions || 0),
          },
          departmentDistribution: overviewResult[0]?.department_distribution || [],
        }

        filename = `ippis-overview-report-${format(new Date(), "yyyy-MM-dd")}`
        break

      case "employees":
        const employeesQuery = `
          SELECT 
            id,
            name,
            email,
            department,
            position,
            status,
            join_date,
            salary
          FROM employees
          WHERE status != 'deleted' ${deptFilter}
          ORDER BY join_date DESC
        `

        const employeesResult = await sql(employeesQuery)

        data = {
          reportType: "Employee Report",
          generatedAt: new Date().toISOString(),
          dateRange: {
            from: startDate,
            to: endDate,
          },
          employees: employeesResult.map((emp) => ({
            id: emp.id,
            name: emp.name,
            email: emp.email,
            department: emp.department,
            position: emp.position,
            status: emp.status,
            joinDate: emp.join_date,
            salary: Number(emp.salary),
          })),
        }

        filename = `ippis-employees-report-${format(new Date(), "yyyy-MM-dd")}`
        break

      case "payroll":
        const payrollQuery = `
          SELECT 
            e.id,
            e.name,
            e.department,
            e.position,
            e.salary,
            e.bank_name,
            e.account_number
          FROM employees e
          WHERE e.status = 'active' ${deptFilter}
          ORDER BY e.department, e.name
        `

        const payrollResult = await sql(payrollQuery)

        const totalSalary = payrollResult.reduce((sum, emp) => sum + Number(emp.salary), 0)
        const averageSalary = totalSalary / (payrollResult.length || 1)

        // Group by department for summary
        const departmentSummary = payrollResult.reduce((acc, emp) => {
          const dept = emp.department
          if (!acc[dept]) {
            acc[dept] = {
              department: dept,
              employeeCount: 0,
              totalSalary: 0,
            }
          }

          acc[dept].employeeCount++
          acc[dept].totalSalary += Number(emp.salary)

          return acc
        }, {})

        data = {
          reportType: "Payroll Report",
          generatedAt: new Date().toISOString(),
          dateRange: {
            from: startDate,
            to: endDate,
          },
          summary: {
            totalEmployees: payrollResult.length,
            totalSalary,
            averageSalary,
          },
          departmentSummary: Object.values(departmentSummary),
          employees: payrollResult.map((emp) => ({
            id: emp.id,
            name: emp.name,
            department: emp.department,
            position: emp.position,
            salary: Number(emp.salary),
            bankName: emp.bank_name,
            accountNumber: emp.account_number,
          })),
        }

        filename = `ippis-payroll-report-${format(new Date(), "yyyy-MM-dd")}`
        break

      default:
        return NextResponse.json(
          {
            error: "Invalid report type",
          },
          { status: 400 },
        )
    }

    // Format the response based on the requested format
    switch (exportFormat) {
      case "json":
        return new NextResponse(JSON.stringify(data, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${filename}.json"`,
          },
        })

      case "csv":
        // Simple CSV conversion for the first level of data
        let csv = ""

        if (reportType === "employees" || reportType === "payroll") {
          // For reports with tabular data
          const rows = data.employees
          if (rows && rows.length > 0) {
            // Headers
            csv = Object.keys(rows[0]).join(",") + "\n"

            // Data rows
            rows.forEach((row) => {
              csv +=
                Object.values(row)
                  .map((value) => {
                    // Escape commas and quotes
                    if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                      return `"${value.replace(/"/g, '""')}"`
                    }
                    return value
                  })
                  .join(",") + "\n"
            })
          }
        } else {
          // For summary reports, flatten the structure
          const flattenObject = (obj, prefix = "") => {
            return Object.keys(obj).reduce((acc, key) => {
              const pre = prefix.length ? `${prefix}.` : ""
              if (
                typeof obj[key] === "object" &&
                obj[key] !== null &&
                !Array.isArray(obj[key]) &&
                Object.keys(obj[key]).length > 0
              ) {
                Object.assign(acc, flattenObject(obj[key], `${pre}${key}`))
              } else if (!Array.isArray(obj[key])) {
                acc[`${pre}${key}`] = obj[key]
              }
              return acc
            }, {})
          }

          const flatData = flattenObject(data)

          // Headers
          csv = Object.keys(flatData).join(",") + "\n"

          // Values
          csv += Object.values(flatData)
            .map((value) => {
              if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`
              }
              return value
            })
            .join(",")
        }

        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${filename}.csv"`,
          },
        })

      default:
        return NextResponse.json(
          {
            error: "Unsupported export format",
          },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error("Report export error:", error)
    return NextResponse.json(
      {
        error: "Failed to export report",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
