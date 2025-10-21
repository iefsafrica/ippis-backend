import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get("limit") || "10")

    const sql = neon(process.env.DATABASE_URL!)

    // Default activities
    let activities = []

    try {
      // Check if tables exist before querying
      const tablesExist = await checkTablesExist(sql)

      if (tablesExist) {
        const query = `
          SELECT 
            action,
            user_name as user,
            details as description,
            created_at as timestamp
          FROM 
            activity_log
          ORDER BY 
            created_at DESC
          LIMIT $1
        `

        const result = await sql.query(query, [limit])

        if (result.rows.length > 0) {
          activities = result.rows.map((row) => ({
            action: row.action,
            user: row.user,
            description: row.description,
            time: formatRelativeTime(new Date(row.timestamp)),
          }))
        } else {
          activities = generateMockActivities(limit)
        }
      } else {
        activities = generateMockActivities(limit)
      }
    } catch (dbError) {
      console.error("Database error:", dbError)
      activities = generateMockActivities(limit)
    }

    return NextResponse.json({
      success: true,
      data: activities,
    })
  } catch (error) {
    console.error("Error fetching activities:", error)
    return NextResponse.json({
      success: true,
      data: generateMockActivities(10),
      message: "Using default activity data due to an error",
    })
  }
}

// Helper function to check if required tables exist
async function checkTablesExist(sql: any) {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'activity_log'
      ) as activity_log_exist
    `

    const result = await sql.query(query)

    // Check if result and result.rows exist before accessing length
    if (!result || !result.rows) {
      console.warn("Unexpected query result format:", result)
      return false
    }

    if (result.rows.length === 0) return false

    return result.rows[0].activity_log_exist
  } catch (error) {
    console.error("Error checking tables:", error)
    return false
  }
}

// Format timestamp to relative time (e.g., "2 hours ago")
function formatRelativeTime(date: Date) {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.round(diffMs / 1000)
  const diffMins = Math.round(diffSecs / 60)
  const diffHours = Math.round(diffMins / 60)
  const diffDays = Math.round(diffHours / 24)

  if (diffSecs < 60) return `${diffSecs} seconds ago`
  if (diffMins < 60) return `${diffMins} minutes ago`
  if (diffHours < 24) return `${diffHours} hours ago`
  if (diffDays < 30) return `${diffDays} days ago`

  return date.toLocaleDateString()
}

// Generate mock activity data
function generateMockActivities(limit: number) {
  const actions = ["Registration", "Approval", "Document Verification", "Login", "Update"]
  const users = ["System", "Admin", "Supervisor", "Manager"]
  const descriptions = [
    "New employee registration",
    "Employee registration approved",
    "Document verified successfully",
    "User logged in",
    "Employee information updated",
  ]

  return Array.from({ length: limit }, (_, i) => {
    const actionIndex = Math.floor(Math.random() * actions.length)

    return {
      action: actions[actionIndex],
      user: users[Math.floor(Math.random() * users.length)],
      description: descriptions[actionIndex],
      time: formatRelativeTime(new Date(Date.now() - Math.floor(Math.random() * 72) * 60 * 60 * 1000)),
    }
  })
}
