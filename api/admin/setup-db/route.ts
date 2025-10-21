import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST(request: Request) {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Create employees table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        department VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        join_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `

    // Create registration_history table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS registration_history (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(20) NOT NULL,
        action VARCHAR(50) NOT NULL,
        details TEXT,
        performed_by VARCHAR(100),
        performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `

    // Check if we need to seed initial data
    const employeeCount = await sql`SELECT COUNT(*) as count FROM employees`

    if (employeeCount[0].count === 0) {
      // Seed some initial employees
      const initialEmployees = [
        {
          id: "EMP12345",
          name: "John Doe",
          email: "john.doe@example.com",
          department: "Finance",
          position: "Senior Accountant",
          status: "active",
          join_date: "2023-01-15",
        },
        {
          id: "EMP12346",
          name: "Jane Smith",
          email: "jane.smith@example.com",
          department: "HR",
          position: "HR Manager",
          status: "active",
          join_date: "2022-11-05",
        },
        {
          id: "EMP12347",
          name: "Michael Johnson",
          email: "michael.j@example.com",
          department: "IT",
          position: "Systems Administrator",
          status: "active",
          join_date: "2023-03-22",
        },
        {
          id: "EMP12348",
          name: "Sarah Williams",
          email: "sarah.w@example.com",
          department: "Operations",
          position: "Operations Director",
          status: "inactive",
          join_date: "2021-08-10",
        },
        {
          id: "EMP12349",
          name: "Robert Brown",
          email: "robert.b@example.com",
          department: "Legal",
          position: "Legal Counsel",
          status: "active",
          join_date: "2022-05-18",
        },
      ]

      // Insert each employee
      for (const emp of initialEmployees) {
        await sql`
          INSERT INTO employees (id, name, email, department, position, status, join_date)
          VALUES (
            ${emp.id}, 
            ${emp.name}, 
            ${emp.email}, 
            ${emp.department}, 
            ${emp.position}, 
            ${emp.status}, 
            ${emp.join_date}
          )
        `

        // Add to history
        await sql`
          INSERT INTO registration_history (
            registration_id, 
            action, 
            details, 
            performed_by
          )
          VALUES (
            ${emp.id}, 
            'added', 
            'Initial employee data seeded', 
            'System'
          )
        `
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database setup completed successfully",
    })
  } catch (error) {
    console.error("Database setup error:", error)
    return NextResponse.json(
      {
        error: "Failed to set up database",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
