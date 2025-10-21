import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL environment variable is not defined" },
        { status: 500 },
      )
    }

    const sql = neon(process.env.DATABASE_URL)

    // Check if table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `

    if (!tableExists[0].exists) {
      return NextResponse.json(
        {
          success: false,
          message: "Table pending_employees does not exist",
        },
        { status: 404 },
      )
    }

    // Get the current columns from the table
    const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'pending_employees'
      ORDER BY ordinal_position;
    `

    const columnNames = columns.map((col) => col.column_name)
    console.log("Existing columns:", columnNames)

    // Check if metadata column exists
    const hasMetadata = columnNames.includes("metadata")

    // Create a new table with the desired column order but WITHOUT constraints
    let createTableSQL = `
      CREATE TABLE pending_employees_new (
        id integer NOT NULL,
        registration_id text NOT NULL,
        surname text NOT NULL,
        firstname text NOT NULL,
        email text NOT NULL,
        department text,
        position text,
        status text NOT NULL DEFAULT 'pending_approval'::text,
        source text NOT NULL DEFAULT 'form'::text,
        submission_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        missing_fields jsonb,
        created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
    `

    // Add metadata column if it exists in the original table
    if (hasMetadata) {
      createTableSQL += `,
        metadata jsonb
      `
    }

    createTableSQL += `)`

    await sql.query(createTableSQL)

    // Prepare column lists for the INSERT statement
    let targetColumns = `
      id, registration_id, surname, firstname, email, department, position, 
      status, source, submission_date, missing_fields, created_at, updated_at
    `

    let sourceColumns = targetColumns

    if (hasMetadata) {
      targetColumns += `, metadata`
      sourceColumns += `, metadata`
    }

    // Copy data from the old table to the new one
    await sql.query(`
      INSERT INTO pending_employees_new (
        ${targetColumns}
      )
      SELECT 
        ${sourceColumns}
      FROM pending_employees
    `)

    // Now add constraints to the new table
    await sql`
      ALTER TABLE pending_employees_new ADD PRIMARY KEY (id);
      ALTER TABLE pending_employees_new ALTER COLUMN id SET DEFAULT nextval('pending_employees_id_seq'::regclass);
      ALTER TABLE pending_employees_new ADD CONSTRAINT pending_employees_new_registration_id_key UNIQUE (registration_id);
    `

    // Drop the old table
    await sql`DROP TABLE pending_employees CASCADE`

    // Rename the new table to the original name
    await sql`ALTER TABLE pending_employees_new RENAME TO pending_employees`

    // Rename the constraint to match the original name
    await sql`
      ALTER TABLE pending_employees 
      RENAME CONSTRAINT pending_employees_new_registration_id_key TO pending_employees_registration_id_key
    `

    // Reset the sequence
    await sql`
      SELECT setval('pending_employees_id_seq', (SELECT MAX(id) FROM pending_employees), true)
    `

    return NextResponse.json({
      success: true,
      message: "Successfully re-arranged columns in pending_employees table",
    })
  } catch (error) {
    console.error("Error re-arranging columns:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to re-arrange columns",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
