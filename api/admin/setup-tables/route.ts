import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const sql = neon(process.env.DATABASE_URL!)

    // Create the necessary tables
    await sql`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        sub_status TEXT DEFAULT 'pending_approval',
        current_step TEXT NOT NULL DEFAULT 'submitted',
        source TEXT NOT NULL DEFAULT 'form',
        declaration BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS personal_info (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL REFERENCES registrations(registration_id),
        title TEXT,
        surname TEXT,
        first_name TEXT,
        other_names TEXT,
        phone_number TEXT,
        email TEXT,
        date_of_birth DATE,
        sex TEXT,
        marital_status TEXT,
        state_of_origin TEXT,
        lga TEXT,
        state_of_residence TEXT,
        address_state_of_residence TEXT,
        next_of_kin_name TEXT,
        next_of_kin_relationship TEXT,
        next_of_kin_phone_number TEXT,
        next_of_kin_address TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employment_info (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL REFERENCES registrations(registration_id),
        employment_id_no TEXT,
        service_no TEXT,
        file_no TEXT,
        rank_position TEXT,
        department TEXT,
        organization TEXT,
        employment_type TEXT,
        probation_period TEXT,
        work_location TEXT,
        date_of_first_appointment DATE,
        gl TEXT,
        step TEXT,
        salary_structure TEXT,
        cadre TEXT,
        name_of_bank TEXT,
        account_number TEXT,
        pfa_name TEXT,
        rsapin TEXT,
        educational_background TEXT,
        certifications TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `

    return NextResponse.json({
      success: true,
      message: "Tables created successfully",
    })
  } catch (error) {
    console.error("Error setting up tables:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up tables",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
