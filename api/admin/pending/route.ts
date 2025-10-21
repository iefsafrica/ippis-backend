import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"

// Make this route dynamic to avoid caching
export const dynamic = "force-dynamic"

// Helper function to check if a table exists
async function tableExists(tableName: string) {
  try {
    const result = await pool.query(
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `,
      [tableName],
    )
    return result.rows[0].exists
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error)
    return false
  }
}

// Helper function to get table columns
async function getTableColumns(tableName: string) {
  try {
    const result = await pool.query(
      `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = $1;
    `,
      [tableName],
    )
    return result.rows
  } catch (error) {
    console.error(`Error getting columns for table ${tableName}:`, error)
    return []
  }
}

// Helper function to safely format date fields in the result
function formatDateFields(rows: any[]) {
  return rows.map((row) => {
    const formattedRow = { ...row }

    // Format date fields if they exist
    if (formattedRow.submissionDate) {
      try {
        // Check if it's already a valid date string
        const date = new Date(formattedRow.submissionDate)
        if (isNaN(date.getTime())) {
          formattedRow.submissionDate = null
        }
      } catch (e) {
        formattedRow.submissionDate = null
      }
    }

    if (formattedRow.created_at) {
      try {
        const date = new Date(formattedRow.created_at)
        if (isNaN(date.getTime())) {
          formattedRow.created_at = null
        } else {
          formattedRow.createdAt = formattedRow.created_at.toISOString()
        }
      } catch (e) {
        formattedRow.created_at = null
        formattedRow.createdAt = null
      }
    }

    if (formattedRow.updated_at) {
      try {
        const date = new Date(formattedRow.updated_at)
        if (isNaN(date.getTime())) {
          formattedRow.updated_at = null
        } else {
          formattedRow.updatedAt = formattedRow.updated_at.toISOString()
        }
      } catch (e) {
        formattedRow.updated_at = null
        formattedRow.updatedAt = null
      }
    }

    return formattedRow
  })
}

export async function GET(request: Request) {
  try {
    console.log("Starting pending employees API request")

    const { searchParams } = new URL(request.url)
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "10")
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""

    const offset = (page - 1) * limit

    console.log("Checking if pending_employees table exists")

    // Check if the table exists
    const tableExistsResult = await tableExists("pending_employees")
    if (!tableExistsResult) {
      console.log("Table pending_employees does not exist")
      return NextResponse.json(
        {
          success: false,
          error: "The pending_employees table does not exist in the database",
          errorCode: "TABLE_NOT_FOUND",
        },
        { status: 404 },
      )
    }

    console.log("Table pending_employees exists, getting columns")

    // Get table columns to ensure we're querying valid columns
    const columns = await getTableColumns("pending_employees")
    console.log("Table columns:", columns)

    // Check if required columns exist
    const hasFirstname = columns.some((col) => col.column_name === "firstname")
    const hasSurname = columns.some((col) => col.column_name === "surname")
    const hasEmail = columns.some((col) => col.column_name === "email")
    const hasDepartment = columns.some((col) => col.column_name === "department")
    const hasStatus = columns.some((col) => col.column_name === "status")
    const hasCreatedAt = columns.some((col) => col.column_name === "created_at")

    console.log("Column check:", { hasFirstname, hasSurname, hasEmail, hasDepartment, hasStatus, hasCreatedAt })

    // Build the query with filters
    let queryText = `
      SELECT * FROM pending_employees 
      WHERE 1=1
    `

    const params: any[] = []

    if (search && (hasEmail || hasDepartment || hasFirstname || hasSurname)) {
      queryText += ` AND (`

      const searchConditions = []

      if (hasEmail) {
        searchConditions.push(`email ILIKE $${params.length + 1}`)
        params.push(`%${search}%`)
      }

      if (hasDepartment) {
        searchConditions.push(`department ILIKE $${params.length + 1}`)
        params.push(`%${search}%`)
      }

      if (hasFirstname) {
        searchConditions.push(`firstname ILIKE $${params.length + 1}`)
        params.push(`%${search}%`)
      }

      if (hasSurname) {
        searchConditions.push(`surname ILIKE $${params.length + 1}`)
        params.push(`%${search}%`)
      }

      queryText += searchConditions.join(" OR ")
      queryText += `)`
    }

    if (status && status !== "all" && hasStatus) {
      queryText += ` AND status = $${params.length + 1}`
      params.push(status)
    }

    // Add ORDER BY to sort in descending order by created_at if it exists
    if (hasCreatedAt) {
      queryText += ` ORDER BY created_at DESC`
    } else {
      queryText += ` ORDER BY id DESC`
    }

    // Add pagination
    queryText += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    console.log("Executing query:", queryText, "with params:", params)

    // Execute the query using the pool
    const result = await pool.query(queryText, params)

    console.log("Query result:", result.rows.length, "rows returned")

    // Format date fields to ensure they're valid
    const formattedRows = formatDateFields(result.rows)

    // Get total count for pagination
    let countQueryText = `
      SELECT COUNT(*) as total FROM pending_employees 
      WHERE 1=1
    `

    const countParams: any[] = []

    if (search && (hasEmail || hasDepartment || hasFirstname || hasSurname)) {
      countQueryText += ` AND (`

      const searchConditions = []

      if (hasEmail) {
        searchConditions.push(`email ILIKE $${countParams.length + 1}`)
        countParams.push(`%${search}%`)
      }

      if (hasDepartment) {
        searchConditions.push(`department ILIKE $${countParams.length + 1}`)
        countParams.push(`%${search}%`)
      }

      if (hasFirstname) {
        searchConditions.push(`firstname ILIKE $${countParams.length + 1}`)
        countParams.push(`%${search}%`)
      }

      if (hasSurname) {
        searchConditions.push(`surname ILIKE $${countParams.length + 1}`)
        countParams.push(`%${search}%`)
      }

      countQueryText += searchConditions.join(" OR ")
      countQueryText += `)`
    }

    if (status && status !== "all" && hasStatus) {
      countQueryText += ` AND status = $${countParams.length + 1}`
      countParams.push(status)
    }

    console.log("Executing count query:", countQueryText, "with params:", countParams)

    const countResult = await pool.query(countQueryText, countParams)
    const total = Number.parseInt(countResult.rows[0].total)

    console.log("Count result:", total)

   return NextResponse.json({
  success: true,
  data: {
    employees: formattedRows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error("Error fetching pending employees:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch pending employees from database",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
