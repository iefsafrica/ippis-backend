import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    message: "This endpoint requires a POST request to seed test employees",
    instructions: "Make a POST request to this endpoint to seed test employees",
  })
}

export async function POST() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Check if the pending_employees table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `

    const tableExists = tableCheck[0]?.exists

    if (!tableExists) {
      // Create the table if it doesn't exist
      await sql`
        CREATE TABLE IF NOT EXISTS pending_employees (
          id SERIAL PRIMARY KEY,
          registration_id TEXT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          department TEXT,
          position TEXT,
          status TEXT NOT NULL DEFAULT 'pending_approval',
          source TEXT NOT NULL DEFAULT 'import',
          submission_date TIMESTAMP NOT NULL DEFAULT NOW(),
          missing_fields JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `
      console.log("Created pending_employees table")
    }

    // Generate 5 test employees
    const testEmployees = [
      {
        id: "TEST001",
        name: "John Doe",
        email: "john.doe@example.com",
        department: "IT",
        position: "Developer",
      },
      {
        id: "TEST002",
        name: "Jane Smith",
        email: "jane.smith@example.com",
        department: "HR",
        position: "Manager",
      },
      {
        id: "TEST003",
        name: "Michael Johnson",
        email: "michael.johnson@example.com",
        department: "Finance",
        position: "Accountant",
      },
      {
        id: "TEST004",
        name: "Sarah Williams",
        email: "sarah.williams@example.com",
        department: "Marketing",
        position: "Specialist",
      },
      {
        id: "TEST005",
        name: "Robert Brown",
        email: "robert.brown@example.com",
        department: "Operations",
        position: "Coordinator",
      },
    ]

    // Clear existing test employees to avoid duplicates
    await sql`DELETE FROM pending_employees WHERE source = 'test'`

    // Insert test employees into the pending_employees table
    for (const employee of testEmployees) {
      await sql`
        INSERT INTO pending_employees (
          registration_id,
          name,
          email,
          department,
          position,
          status,
          source,
          submission_date
        ) VALUES (
          ${employee.id},
          ${employee.name},
          ${employee.email},
          ${employee.department},
          ${employee.position},
          'pending_approval',
          'test',
          NOW()
        )
      `
    }

    return NextResponse.json({
      success: true,
      message: "Successfully seeded 5 test pending employees",
      employees: testEmployees,
    })
  } catch (error) {
    console.error("Error seeding test employees:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to seed test employees",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
