import { NextResponse } from "next/server"
import { pool } from "@/lib/db-connection"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    // Get the table name from query params
    const { searchParams } = new URL(request.url)
    const tableName = searchParams.get("table") || "pending_employees"

    // Check if the table exists
    const tableExistsResult = await pool.query(
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `,
      [tableName],
    )

    const tableExists = tableExistsResult.rows[0].exists

    if (!tableExists) {
      return NextResponse.json({
        success: false,
        error: `Table ${tableName} does not exist`,
      })
    }

    // Get table columns
    const columnsResult = await pool.query(
      `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = $1
      ORDER BY ordinal_position;
    `,
      [tableName],
    )

    // Get primary key
    const pkResult = await pool.query(
      `
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
      AND i.indisprimary;
    `,
      [`public.${tableName}`],
    )

    // Get sample data (first 5 rows)
    const sampleDataResult = await pool.query(`
      SELECT * FROM ${tableName} LIMIT 5;
    `)

    return NextResponse.json({
      success: true,
      data: {
        tableName,
        exists: tableExists,
        columns: columnsResult.rows,
        primaryKey: pkResult.rows.map((row) => row.attname),
        sampleData: sampleDataResult.rows,
        rowCount: sampleDataResult.rowCount,
      },
    })
  } catch (error) {
    console.error("Error getting table structure:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get table structure",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
