import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../../lib/cors"
import { NextRequest } from "next/server"
import nodemailer from "nodemailer"

export const dynamic = "force-dynamic"

// Neon client
const sql = neon(process.env.DATABASE_URL!)

// Helper: check if table exists
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

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// PATCH: Approve pending employee (move to active employees)
export async function PATCH(req: NextRequest, { params }: { params: { id?: string } }) {
  try {
    console.log("Approving pending employee...")

    //  1. Get registration ID
    let registrationId = params?.id

    if (!registrationId) {
      try {
        const json = (await req.json()) as { id?: string; registration_id?: string }
        registrationId = json.registration_id || json.id
      } catch {
        // ignore parsing error
      }
    }

    if (!registrationId || registrationId.trim() === "") {
      return withCors(req, { success: false, error: "Registration ID is required." }, 400)
    }

    //  2. Ensure tables exist
    const pendingExists = await tableExists("pending_employees")
    const employeesExists = await tableExists("employees")

    if (!pendingExists || !employeesExists) {
      return withCors(req, {
        success: false,
        error: "Required database tables do not exist.",
      }, 404)
    }

    //  3. Fetch pending employee
    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `
    const pendingEmployee = pendingEmployeeResult[0]

    if (!pendingEmployee) {
      return withCors(req, {
        success: false,
        error: `Pending employee with registration ID ${registrationId} not found.`,
      }, 404)
    }

    //  4. Combine surname + firstname → name
    const fullName = `${pendingEmployee.surname ?? ""} ${pendingEmployee.firstname ?? ""}`.trim() || "Unnamed Employee"

    //  5. Generate new unique employee ID
    const newId = `EMP${Math.floor(100000 + Math.random() * 900000)}`

    //  6. Insert into employees (or update existing email)
    const insertedEmployeeResult = await sql`
      INSERT INTO employees (
        id,
        registration_id,
        name,
        email,
        position,
        department,
        status,
        join_date,
        created_at,
        updated_at
      )
      VALUES (
        ${newId},
        ${pendingEmployee.registration_id},
        ${fullName},
        ${pendingEmployee.email || "no-email@example.com"},
        ${pendingEmployee.position || "Not Assigned"},
        ${pendingEmployee.department || "Unassigned"},
        'active',
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      ON CONFLICT (email)
      DO UPDATE SET
        status = 'active',
        updated_at = NOW(),
        name = EXCLUDED.name,
        position = EXCLUDED.position,
        department = EXCLUDED.department
      RETURNING *
    `
    const newEmployee = insertedEmployeeResult[0]

    //  7. Delete from pending_employees
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`

    //  8. Send approval email
    try {
      if (newEmployee?.email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.SMTP_USER!,
            pass: process.env.SMTP_PASS!,
          },
        })

        await transporter.sendMail({
          from: `"HR Department" <${process.env.SMTP_USER}>`,
          to: newEmployee.email,
          subject: "Your Employment Has Been Approved",
          text: `Hi ${fullName},\n\nCongratulations! Your employment has been approved and your account is now active.\n\nWelcome aboard!\n\n— The HR Team`,
        })

        console.log(` Approval email sent to: ${newEmployee.email}`)
      } else {
        console.warn(" Skipping email — no valid employee record or email found.")
      }
    } catch (emailError) {
      console.error(" Failed to send approval email:", emailError)
    }

    //  9. Return success response
    return withCors(req, {
      success: true,
      message: `Employee ${registrationId} approved successfully and moved to employees table.`,
      data: newEmployee,
    })
  } catch (error) {
    console.error("Error approving employee:", error)
    return withCors(
      req,
      {
        success: false,
        error: "Failed to approve employee.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
}
