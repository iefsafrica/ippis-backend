import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const sql = neon(process.env.DATABASE_URL!)

  try {
    const registrationId = params.id
    const { comment } = await request.json()

    // Check if registration exists and is pending approval
    const checkResult = await sql`
      SELECT status FROM registrations WHERE registration_id = ${registrationId}
    `

    if (checkResult.length === 0) {
      return NextResponse.json(
        {
          error: "Registration not found",
        },
        { status: 404 },
      )
    }

    if (checkResult[0].status !== "pending_approval") {
      return NextResponse.json(
        {
          error: "Registration is not pending approval",
        },
        { status: 400 },
      )
    }

    // Get registration data
    const [personalResult, employmentResult] = await Promise.all([
      sql`
        SELECT * FROM personal_info WHERE registration_id = ${registrationId}
      `,
      sql`
        SELECT * FROM employment_info WHERE registration_id = ${registrationId}
      `,
    ])

    if (personalResult.length === 0) {
      return NextResponse.json(
        {
          error: "Personal information not found",
        },
        { status: 400 },
      )
    }

    // Generate employee ID
    const employeeId = `EMP${Math.floor(10000 + Math.random() * 90000)}`

    // Create employee record
    const personalInfo = personalResult[0]
    const employmentInfo = employmentResult.length > 0 ? employmentResult[0] : null

    // Ensure employees table exists
    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        department TEXT,
        position TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        join_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `

    // Create employee record
    await sql`
      INSERT INTO employees (
        employee_id,
        name,
        email,
        department,
        position,
        status,
        join_date
      )
      VALUES (
        ${employeeId},
        ${`${personalInfo.title || ""} ${personalInfo.first_name} ${personalInfo.surname}`.trim()},
        ${personalInfo.email},
        ${employmentInfo?.department || null},
        ${employmentInfo?.rank_position || null},
        'active',
        CURRENT_DATE
      )
    `

    // Update registration status
    await sql`
      UPDATE registrations
      SET 
        status = 'approved',
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE registration_id = ${registrationId}
    `

    // Create registration_comments table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS registration_comments (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        author TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `

    // Add comment if provided
    if (comment) {
      await sql`
        INSERT INTO registration_comments (
          registration_id,
          comment_text,
          author
        )
        VALUES (
          ${registrationId},
          ${comment},
          'Admin'
        )
      `
    }

    // Create registration_history table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS registration_history (
        id SERIAL PRIMARY KEY,
        registration_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        performed_by TEXT,
        performed_at TIMESTAMP NOT NULL DEFAULT NOW()
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
        ${registrationId},
        'approved',
        ${`Registration approved and employee created with ID ${employeeId}`},
        'Admin'
      )
    `

    // In a real application, send email notification to the employee
    // This would typically use a service like SendGrid, Mailgun, etc.
    console.log(`Email notification would be sent to ${personalInfo.email} about approval`)

    return NextResponse.json({
      success: true,
      data: {
        employeeId,
        message: "Registration approved successfully",
      },
    })
  } catch (error) {
    console.error("Approve registration error:", error)
    return NextResponse.json(
      {
        error: "Failed to approve registration",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
