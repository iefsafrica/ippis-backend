import { NextResponse } from "next/server"

// Make this route dynamic to avoid caching
export const dynamic = "force-dynamic"

// Generate mock data
function generateMockPendingEmployees(count: number, startIndex = 0) {
  const statuses = ["pending_approval", "document_verification", "data_incomplete"]
  const departments = ["HR", "Finance", "IT", "Operations", "Marketing", "Sales"]
  const positions = ["Manager", "Assistant", "Coordinator", "Specialist", "Director", "Officer"]

  return Array.from({ length: count }, (_, i) => {
    const index = startIndex + i
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    const department = departments[Math.floor(Math.random() * departments.length)]
    const position = positions[Math.floor(Math.random() * positions.length)]

    const date = new Date()
    date.setDate(date.getDate() - Math.floor(Math.random() * 30))

    return {
      id: index + 1,
      registrationId: `REG-${(10000 + index).toString()}`,
      name: `Test Employee ${index + 1}`,
      email: `employee${index + 1}@example.com`,
      department,
      position,
      status,
      submissionDate: date.toISOString(),
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
    }
  })
}

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "10")
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || "all"

    // Total number of mock records
    const totalRecords = 50

    // Generate all records first
    let allRecords = generateMockPendingEmployees(totalRecords)

    // Apply filters if needed
    if (search) {
      allRecords = allRecords.filter(
        (record) =>
          record.name.toLowerCase().includes(search.toLowerCase()) ||
          record.email.toLowerCase().includes(search.toLowerCase()) ||
          record.registrationId.toLowerCase().includes(search.toLowerCase()),
      )
    }

    if (status !== "all") {
      allRecords = allRecords.filter((record) => record.status === status)
    }

    // Calculate pagination
    const total = allRecords.length
    const totalPages = Math.ceil(total / limit)
    const offset = (page - 1) * limit
    const paginatedRecords = allRecords.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        pendingEmployees: paginatedRecords,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Mock pending employees error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate mock pending employees",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
