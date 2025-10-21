import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    console.log("Mock import API called")

    const formData = await request.formData()
    const file = formData.get("file") as File
    const validateOnly = formData.get("validate") === "true"

    console.log("File received:", file?.name, "Size:", file?.size, "Validate only:", validateOnly)

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Return success response
    return NextResponse.json({
      success: true,
      message: "Successfully imported employees (mock)",
      totalRecords: 4,
      validRecords: 4,
      invalidRecords: 0,
      addedEmployees: [
        {
          id: "REG123456",
          name: "John Doe",
          email: "john.doe@example.com",
          department: "IT",
          position: "Developer",
          status: "pending_approval",
          source: "import",
          submissionDate: new Date().toISOString(),
        },
        {
          id: "REG123457",
          name: "Jane Smith",
          email: "jane.smith@example.com",
          department: "HR",
          position: "Manager",
          status: "pending_approval",
          source: "import",
          submissionDate: new Date().toISOString(),
        },
      ],
      emailsSent: [
        { id: 1, email: "john.doe@example.com", subject: "IPPIS: Document Upload Required" },
        { id: 2, email: "jane.smith@example.com", subject: "IPPIS: Document Upload Required" },
      ],
    })
  } catch (error) {
    console.error("Mock import error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to import employees (mock)",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
