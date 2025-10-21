import { NextResponse } from "next/server";
//import { sql } from "@neondatabase/serverless"
import { sql } from "drizzle-orm";

// Make this route dynamic to avoid caching
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Check if the table exists first
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'pending_employees'
      );
    `;

    if (!tableExists[0].exists) {
      return NextResponse.json(
        {
          success: false,
          error: "The pending_employees table does not exist",
        },
        { status: 404 }
      );
    }

    // Delete all records from the pending_employees table
    await sql`TRUNCATE TABLE pending_employees`;

    return NextResponse.json({
      success: true,
      message: "All pending employees have been cleared",
    });
  } catch (error) {
    console.error("Error clearing pending employees:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to clear pending employees",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
