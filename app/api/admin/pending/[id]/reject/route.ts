import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../../lib/cors"
import { NextRequest } from "next/server"
import nodemailer from "nodemailer"

export const dynamic = "force-dynamic"

// Neon client
const sql = neon(process.env.DATABASE_URL!)

// Helper to check if a table exists
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

// ✅ PATCH: Approve pending employee (Next.js 15 compatible)
export async function PATCH(req: NextRequest) {
  try {
    console.log("Approving pending employee...")

    // 1️⃣ Extract ID from URL (since Next.js 15 no longer injects params)
    const url = new URL(req.url)
    const pathParts = url.pathname.split("/")
    const registrationId = decodeURIComponent(pathParts[pathParts.length - 2] || "").trim()

    if (!registrationId) {
      return withCors(req, { success: false, error: "Registration ID is required in the URL." }, 400)
    }

    // 2️⃣ Ensure both tables exist
    const pendingExists = await tableExists("pending_employees")
    const employeesExists = await tableExists("employees")

    if (!pendingExists || !employeesExists) {
      return withCors(
        req,
        { success: false, error: "Required database tables do not exist." },
        404
      )
    }

    // 3️⃣ Fetch pending employee
    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `
    const pendingEmployee = pendingEmployeeResult[0]

    if (!pendingEmployee) {
      return withCors(
        req,
        { success: false, error: `Pending employee with registration ID ${registrationId} not found.` },
        404
      )
    }

    // 4️⃣ Combine surname + firstname → full name
    const fullName =
      `${pendingEmployee.surname ?? ""} ${pendingEmployee.firstname ?? ""}`.trim() ||
      "Unnamed Employee"

    // 5️⃣ Generate unique employee ID
    const newId = `EMP${Math.floor(100000 + Math.random() * 900000)}`

    // 6️⃣ Insert into employees (handle duplicates by email)
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

    // 7️⃣ Delete from pending_employees
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`

    // 8️⃣ Send approval email
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

        console.log(`✅ Approval email sent to: ${newEmployee.email}`)
      } else {
        console.warn("⚠️ Skipping email — no valid email found.")
      }
    } catch (emailError) {
      console.error("⚠️ Failed to send approval email:", emailError)
    }

    // 9️⃣ Return success
    return withCors(req, {
      success: true,
      message: `Employee ${registrationId} approved successfully and moved to employees table.`,
      data: newEmployee,
    })
  } catch (error) {
    console.error("❌ Error approving employee:", error)
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
