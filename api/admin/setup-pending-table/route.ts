import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"

export async function POST(request: Request) {
  try {
    console.log("Creating pending_employees table if it doesn't exist")

    // Check if the table exists
    const tableExistsResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `)

    const tableExists = tableExistsResult.rows[0].exists

    if (tableExists) {
      console.log("Table pending_employees already exists")
      return NextResponse.json({
        success: true,
        message: "Table pending_employees already exists",
        created: false,
      })
    }

    // Create the table
    await pool.query(`
      CREATE TABLE pending_employees (
        id SERIAL PRIMARY KEY,
        firstname VARCHAR(255),
        surname VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        department VARCHAR(255),
        position VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    console.log("Table pending_employees created successfully")

    return NextResponse.json({
      success: true,
      message: "Table pending_employees created successfully",
      created: true,
    })
  } catch (error) {
    console.error("Error creating pending_employees table:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create pending_employees table",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
