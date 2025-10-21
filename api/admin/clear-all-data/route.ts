import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST(request: Request) {
  try {
    console.log("Clearing all data from database tables...")

    // Check if DATABASE_URL is configured
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not configured")
    }

    const sql = neon(process.env.DATABASE_URL)

    // Start a transaction
    await sql`BEGIN;`

    try {
      // Get all tables in the public schema
      const tables = await sql`
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename NOT IN ('_prisma_migrations', 'schema_migrations');
      `

      console.log(`Found ${tables.length} tables to clear`)

      // Disable foreign key checks temporarily
      await sql`SET CONSTRAINTS ALL DEFERRED;`

      // Truncate each table
      for (const table of tables) {
        const tableName = table.tablename
        console.log(`Truncating table: ${tableName}`)

        try {
          await sql.query(`TRUNCATE TABLE "${tableName}" CASCADE;`)
          console.log(`Successfully truncated table: ${tableName}`)
        } catch (error) {
          console.error(`Error truncating table ${tableName}:`, error)
          // Continue with other tables even if one fails
        }
      }

      // Commit the transaction
      await sql`COMMIT;`

      console.log("Successfully cleared all data from database tables")

      return NextResponse.json({
        success: true,
        message: "Successfully cleared all data from database tables",
      })
    } catch (error) {
      // Rollback the transaction if any error occurs
      await sql`ROLLBACK;`
      throw error
    }
  } catch (error) {
    console.error("Error clearing all data:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to clear all data from database tables",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
