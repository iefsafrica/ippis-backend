import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = neon(process.env.DATABASE_URL!);
    
    // Check which tables have registration_id
    const tables = await db`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE column_name = 'registration_id'
    `;
    
    // Check if 'employees' table exists and its columns
    const empCols = await db`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employees'
    `;

    // Try selecting from registrations and pending_employees
    let samples = {};
    try {
      const reg = await db`SELECT registration_id FROM registrations LIMIT 3`;
      samples = { ...samples, registrations: reg };
    } catch(e:any) {}

    try {
      const emp = await db`SELECT registration_id FROM employees LIMIT 3`;
      samples = { ...samples, employees: emp };
    } catch(e:any) {}

    try {
      const p_emp = await db`SELECT registration_id FROM pending_employees LIMIT 3`;
      samples = { ...samples, pending_employees: p_emp };
    } catch(e:any) {}

    return NextResponse.json({
      tablesWithRegistrationId: tables,
      employeeTableColumns: empCols,
      samples
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
