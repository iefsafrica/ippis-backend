import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"
import {
  canonicalizeRegistrationId,
  normalizeRegistrationId,
} from "../../../../../lib/registration-id"

export const dynamic = "force-dynamic"

// Create Neon client
const sql = neon(process.env.DATABASE_URL!)

// Helper: check if a table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `
    return result[0]?.exists ?? false
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error)
    return false
  }
}

// Generate custom registration ID: IPPIS 001, IPPIS 002, etc.
async function generateRegistrationId() {
  const result = await sql`
    SELECT registration_id
    FROM pending_employees
    WHERE registration_id IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `

  let nextNumber = 1

  if (result.length > 0 && result[0]?.registration_id) {
    const lastId: string = normalizeRegistrationId(result[0].registration_id)
    const match = lastId.match(/IPPIS(\d+)/)
    if (match && match[1]) {
      nextNumber = parseInt(match[1], 10) + 1
    }
  }

  return canonicalizeRegistrationId(`IPPIS-${String(nextNumber).padStart(4, "0")}`)
}

// Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// POST: Add a new pending employee
export async function POST(req: NextRequest) {
  try {
    // Safe JSON parsing
    let body: {
      firstname?: string
      surname?: string
      email?: string
      department?: string
      position?: string
    } = {}

    try {
      body = (await req.json()) as typeof body
    } catch {
      return withCors(
        req,
        {
          success: false,
          error:
            "Invalid or empty JSON body. Please send valid JSON with Content-Type: application/json.",
        },
        400
      )
    }

    const { firstname, surname, email, department, position } = body

    if (!firstname || !surname || !email || !department || !position) {
      return withCors(
        req,
        {
          success: false,
          error:
            "Missing required fields: firstname, surname, email, department, or position.",
        },
        400
      )
    }

    // Ensure table exists
    const exists = await tableExists("pending_employees")
    if (!exists) {
      return withCors(
        req,
        {
          success: false,
          error: "The 'pending_employees' table does not exist in the database.",
        },
        404
      )
    }

    // Check if email already exists
    const emailExists = await sql`
      SELECT 1
      FROM pending_employees
      WHERE email = ${email}
      LIMIT 1
    `
    if (emailExists.length > 0) {
      return withCors(
        req,
        {
          success: false,
          error: "This email is already registered for a pending employee.",
        },
        400
      )
    }

    // Generate registration ID
    const registrationId = await generateRegistrationId()

    // Insert employee into pending_employees
    const inserted = await sql`
      INSERT INTO pending_employees
        (registration_id, firstname, surname, email, department, position, status, source, submission_date, created_at, updated_at)
      VALUES
        (${registrationId}, ${firstname}, ${surname}, ${email}, ${department}, ${position}, 'pending_approval', 'form', NOW(), NOW(), NOW())
      ON CONFLICT (registration_id) DO UPDATE SET
        firstname = EXCLUDED.firstname,
        surname = EXCLUDED.surname,
        email = EXCLUDED.email,
        department = EXCLUDED.department,
        position = EXCLUDED.position,
        status = 'pending_approval',
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING *
    `
    const employee = inserted[0]

    // Generate registration link
    const baseUrl = process.env.APP_URL || "https://ipphis.com"
    const registrationLink = `${baseUrl}/register?email=${encodeURIComponent(email)}`

    // Send registration email
    await sendRegistrationEmail(firstname, email, registrationLink)

    return withCors(req, {
      success: true,
      message: "Employee added successfully and registration email sent.",
      data: employee,
    })
  } catch (error) {
    console.error("❌ Error adding new employee:", error)
    return withCors(
      req,
      {
        success: false,
        error: "Failed to add new employee.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}

// Email Sending Logic (Placeholder)
async function sendRegistrationEmail(firstname: string, email: string, link: string) {
  const subject = "Complete Your IPPHIS Registration"
  const htmlContent = `
    <p>Dear ${firstname},</p>
    <p>Welcome to <strong>IPPHIS</strong>!</p>
    <p>You have been added to our employee management system. Please complete your registration by filling in your details and uploading the required documents.</p>
    <p><a href="${link}" target="_blank">Click here to complete your registration</a></p>
    <p>Thank you,<br/>The IPPHIS Team</p>
  `

  console.log(`📧 Sending email to ${email} with registration link: ${link}`)
}
