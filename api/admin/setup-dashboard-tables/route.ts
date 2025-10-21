import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Check which tables already exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `
    const tablesResult = await sql.query(tablesQuery)
    const existingTables = tablesResult.rows.map((row) => row.table_name)

    const createdTables = []
    const updatedTables = []
    const errors = []

    // Create employees table if it doesn't exist
    if (!existingTables.includes("employees")) {
      try {
        await sql.query(`
          CREATE TABLE employees (
            id SERIAL PRIMARY KEY,
            employee_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            department TEXT NOT NULL,
            position TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            join_date TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            metadata JSONB
          )
        `)
        createdTables.push("employees")
      } catch (error) {
        console.error("Error creating employees table:", error)
        errors.push({ table: "employees", error: error instanceof Error ? error.message : "Unknown error" })
      }
    } else {
      updatedTables.push("employees")
    }

    // Create pending_employees table if it doesn't exist
    if (!existingTables.includes("pending_employees")) {
      try {
        await sql.query(`
          CREATE TABLE pending_employees (
            id SERIAL PRIMARY KEY,
            registration_id TEXT NOT NULL UNIQUE,
            surname TEXT NOT NULL,
            firstname TEXT NOT NULL,
            email TEXT NOT NULL,
            department TEXT,
            position TEXT,
            status TEXT NOT NULL DEFAULT 'pending_approval',
            source TEXT NOT NULL DEFAULT 'form',
            submission_date TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            missing_fields JSONB,
            metadata JSONB
          )
        `)
        createdTables.push("pending_employees")
      } catch (error) {
        console.error("Error creating pending_employees table:", error)
        errors.push({ table: "pending_employees", error: error instanceof Error ? error.message : "Unknown error" })
      }
    } else {
      updatedTables.push("pending_employees")
    }

    // Create documents table if it doesn't exist
    if (!existingTables.includes("documents")) {
      try {
        await sql.query(`
          CREATE TABLE documents (
            id SERIAL PRIMARY KEY,
            document_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            employee_id TEXT NOT NULL,
            employee_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            upload_date TIMESTAMP NOT NULL DEFAULT NOW(),
            verified_date TIMESTAMP,
            rejected_date TIMESTAMP,
            verified_by TEXT,
            rejected_by TEXT,
            comments TEXT,
            file_url TEXT,
            file_type TEXT,
            file_size INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `)
        createdTables.push("documents")
      } catch (error) {
        console.error("Error creating documents table:", error)
        errors.push({ table: "documents", error: error instanceof Error ? error.message : "Unknown error" })
      }
    } else {
      updatedTables.push("documents")
    }

    // Create activities table if it doesn't exist
    if (!existingTables.includes("activities")) {
      try {
        await sql.query(`
          CREATE TABLE activities (
            id SERIAL PRIMARY KEY,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            description TEXT NOT NULL,
            performed_by TEXT NOT NULL,
            performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
            metadata JSONB
          )
        `)
        createdTables.push("activities")
      } catch (error) {
        console.error("Error creating activities table:", error)
        errors.push({ table: "activities", error: error instanceof Error ? error.message : "Unknown error" })
      }
    } else {
      updatedTables.push("activities")
    }

    // Seed some sample data if tables were just created
    if (createdTables.includes("employees") && createdTables.includes("pending_employees")) {
      try {
        // Add sample employees
        await sql.query(`
          INSERT INTO employees (employee_id, name, email, department, position, status, join_date)
          VALUES 
            ('EMP001', 'John Doe', 'john.doe@example.com', 'Engineering', 'Software Engineer', 'active', NOW()),
            ('EMP002', 'Jane Smith', 'jane.smith@example.com', 'Marketing', 'Marketing Manager', 'active', NOW()),
            ('EMP003', 'Robert Johnson', 'robert.johnson@example.com', 'Finance', 'Financial Analyst', 'inactive', NOW())
          ON CONFLICT (employee_id) DO NOTHING
        `)

        // Add sample pending employees
        await sql.query(`
          INSERT INTO pending_employees (registration_id, surname, firstname, email, department, position, status, submission_date)
          VALUES 
            ('REG001', 'Williams', 'Michael', 'michael.williams@example.com', 'HR', 'HR Specialist', 'pending_approval', NOW()),
            ('REG002', 'Brown', 'Sarah', 'sarah.brown@example.com', 'Engineering', 'QA Engineer', 'pending_approval', NOW()),
            ('REG003', 'Davis', 'Thomas', 'thomas.davis@example.com', 'Sales', 'Sales Representative', 'document_verification', NOW())
          ON CONFLICT (registration_id) DO NOTHING
        `)

        // Add sample activities
        if (createdTables.includes("activities")) {
          await sql.query(`
            INSERT INTO activities (action, entity_type, entity_id, description, performed_by, performed_at)
            VALUES 
              ('approve', 'employee', 'REG001', 'Approved employee registration', 'admin', NOW() - INTERVAL '2 days'),
              ('verify', 'document', 'DOC001', 'Verified employee document', 'admin', NOW() - INTERVAL '1 day'),
              ('reject', 'document', 'DOC002', 'Rejected document due to poor quality', 'admin', NOW() - INTERVAL '3 hours')
          `)
        }

        // Add sample documents if the table was created
        if (createdTables.includes("documents")) {
          await sql.query(`
            INSERT INTO documents (document_id, name, type, employee_id, employee_name, status, upload_date)
            VALUES 
              ('DOC001', 'Appointment Letter', 'Employment', 'EMP001', 'John Doe', 'verified', NOW() - INTERVAL '5 days'),
              ('DOC002', 'Educational Certificate', 'Education', 'EMP001', 'John Doe', 'pending', NOW() - INTERVAL '4 days'),
              ('DOC003', 'ID Card', 'Identification', 'EMP002', 'Jane Smith', 'rejected', NOW() - INTERVAL '3 days'),
              ('DOC004', 'Resume', 'Employment', 'EMP002', 'Jane Smith', 'verified', NOW() - INTERVAL '2 days'),
              ('DOC005', 'Medical Certificate', 'Health', 'EMP003', 'Robert Johnson', 'pending', NOW() - INTERVAL '1 day')
            ON CONFLICT (document_id) DO NOTHING
          `)
        }
      } catch (seedError) {
        console.error("Error seeding sample data:", seedError)
        errors.push({ operation: "seed_data", error: seedError instanceof Error ? seedError.message : "Unknown error" })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Dashboard tables setup completed. Created: ${createdTables.join(", ")}. Updated: ${updatedTables.join(", ")}.`,
      created: createdTables,
      updated: updatedTables,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error("Error setting up dashboard tables:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up dashboard tables",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
