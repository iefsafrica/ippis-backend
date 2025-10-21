import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"
import { v4 as uuidv4 } from "uuid"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    // Check if the table exists
    const tableExistsResult = await pool.query(
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `,
    )

    if (!tableExistsResult.rows[0].exists) {
      // Create the table if it doesn't exist
      await pool.query(`
        CREATE TABLE pending_employees (
          id SERIAL PRIMARY KEY,
          registration_id VARCHAR(255),
          firstname VARCHAR(255),
          surname VARCHAR(255),
          email VARCHAR(255),
          department VARCHAR(255),
          position VARCHAR(255),
          status VARCHAR(50),
          source VARCHAR(50),
          submission_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    }

    // Clear existing data
    await pool.query(`DELETE FROM pending_employees;`)

    // Get current timestamp
    const now = new Date().toISOString()

    // Sample data
    const sampleData = [
      {
        registration_id: uuidv4(),
        firstname: "John",
        surname: "Doe",
        email: "john.doe@example.com",
        department: "Human Resources",
        position: "HR Manager",
        status: "pending_approval",
        source: "form",
        submission_date: now,
      },
      {
        registration_id: uuidv4(),
        firstname: "Jane",
        surname: "Smith",
        email: "jane.smith@example.com",
        department: "Finance",
        position: "Accountant",
        status: "document_verification",
        source: "form",
        submission_date: now,
      },
      {
        registration_id: uuidv4(),
        firstname: "Michael",
        surname: "Johnson",
        email: "michael.johnson@example.com",
        department: "IT",
        position: "Software Developer",
        status: "data_incomplete",
        source: "import",
        submission_date: now,
      },
      {
        registration_id: uuidv4(),
        firstname: "Sarah",
        surname: "Williams",
        email: "sarah.williams@example.com",
        department: "Marketing",
        position: "Marketing Specialist",
        status: "pending_approval",
        source: "form",
        submission_date: now,
      },
      {
        registration_id: uuidv4(),
        firstname: "Robert",
        surname: "Brown",
        email: "robert.brown@example.com",
        department: "Operations",
        position: "Operations Manager",
        status: "approved",
        source: "import",
        submission_date: now,
      },
    ]

    // Insert sample data
    for (const employee of sampleData) {
      await pool.query(
        `
        INSERT INTO pending_employees (
          registration_id, firstname, surname, email, department, position, status, source, submission_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          employee.registration_id,
          employee.firstname,
          employee.surname,
          employee.email,
          employee.department,
          employee.position,
          employee.status,
          employee.source,
          employee.submission_date,
        ],
      )
    }

    return NextResponse.json({
      success: true,
      message: "Seeded pending employees successfully",
    })
  } catch (error) {
    console.error("Error seeding pending employees:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to seed pending employees",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
