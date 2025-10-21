import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns"

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Generate labels for the last 6 months
    const today = new Date()
    const labels = []
    const employeeData = []
    const pendingData = []

    // Check if tables exist before querying
    const tablesExist = await checkTablesExist(sql)

    if (tablesExist) {
      // Get data for the last 6 months
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(today, i)
        const monthLabel = format(monthDate, "MMM")
        labels.push(monthLabel)

        const startDate = format(startOfMonth(monthDate), "yyyy-MM-dd")
        const endDate = format(endOfMonth(monthDate), "yyyy-MM-dd")

        // Get employee registrations for this month
        const employeeQuery = `
          SELECT COUNT(*) as count
          FROM employees
          WHERE created_at >= $1 AND created_at <= $2
        `
        const employeeResult = await sql.query(employeeQuery, [startDate, endDate])
        employeeData.push(Number(employeeResult.rows[0]?.count || 0))

        // Get pending registrations for this month
        const pendingQuery = `
          SELECT COUNT(*) as count
          FROM pending_employees
          WHERE created_at >= $1 AND created_at <= $2
        `
        const pendingResult = await sql.query(pendingQuery, [startDate, endDate])
        pendingData.push(Number(pendingResult.rows[0]?.count || 0))
      }
    } else {
      // If tables don't exist, use empty data
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(today, i)
        const monthLabel = format(monthDate, "MMM")
        labels.push(monthLabel)
        employeeData.push(0)
        pendingData.push(0)
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
    }

    return NextResponse.json({
      success: true,
      data: chartData,
    })
  } catch (error) {
    console.error("Error fetching chart data:", error)

    // Return default data instead of an error
    const today = new Date()
    const labels = []

    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(today, i)
      const monthLabel = format(monthDate, "MMM")
      labels.push(monthLabel)
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
    })
  }
}

// Helper function to check if required tables exist
async function checkTablesExist(sql: any) {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'employees'
      ) as employees_exist,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'pending_employees'
      ) as pending_employees_exist
    `

    const result = await sql.query(query)

    // Check if result and result.rows exist before accessing length
    if (!result || !result.rows) {
      console.warn("Unexpected query result format:", result)
      return false
    }

    if (result.rows.length === 0) return false

    const { employees_exist, pending_employees_exist } = result.rows[0]

    // We need at least one of these tables to exist
    return employees_exist || pending_employees_exist
  } catch (error) {
    console.error("Error checking tables:", error)
    return false
  }
}
