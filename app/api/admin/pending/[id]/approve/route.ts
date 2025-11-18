import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch {
    return false;
  }
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(req: NextRequest) {
  try {
    console.log("🚀 Approving pending employee...");

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const registrationId = decodeURIComponent(pathParts[pathParts.length - 2] || "").trim();

    if (!registrationId) {
      return withCors(req, { success: false, error: "Registration ID is required." }, 400);
    }

    const pendingExists = await tableExists("pending_employees");
    const employeesExists = await tableExists("employees");

    if (!pendingExists || !employeesExists) {
      return withCors(req, { success: false, error: "Required tables do not exist." }, 404);
    }

    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;
    const pendingEmployee = pendingEmployeeResult[0];

    if (!pendingEmployee) {
      return withCors(req, {
        success: false,
        error: `No pending employee found for ${registrationId}.`,
      }, 404);
    }

    const fullName = `${pendingEmployee.surname ?? ""} ${
      pendingEmployee.firstname ?? ""
    }`.trim() || pendingEmployee.name || "Unnamed Employee";

    const newId = `EMP${Math.floor(100000 + Math.random() * 900000)}`;

    // 🆕 Include metadata field
    const insertedEmployee = await sql`
      INSERT INTO employees (
        id,
        registration_id,
        name,
        email,
        position,
        department,
        status,
        metadata,
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
        ${pendingEmployee.metadata ? JSON.stringify(pendingEmployee.metadata) : "{}"},
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      ON CONFLICT (email)
      DO UPDATE SET
        status = 'active',
        name = EXCLUDED.name,
        position = EXCLUDED.position,
        department = EXCLUDED.department,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `;

    // 🗑 Remove pending record
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`;

    // 📧 Optional: Send approval email
    try {
      if (insertedEmployee[0]?.email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.SMTP_USER!,
            pass: process.env.SMTP_PASS!,
          },
        });

        await transporter.sendMail({
          from: `"HR Department" <${process.env.SMTP_USER}>`,
          to: insertedEmployee[0].email,
          subject: "Your Approval is Complete",
          text: `Hello ${fullName},\n\nCongratulations! Your employment has been approved.\nYour employee ID is ${newId}.\n\nWelcome onboard!\n\n— HR Team`,
        });

        console.log(`📩 Email sent to: ${insertedEmployee[0].email}`);
      }
    } catch (emailError) {
      console.error("⚠️ Email sending error:", emailError);
    }

    return withCors(req, {
      success: true,
      message: "Employee approved and migrated successfully.",
      data: insertedEmployee[0],
    });
  } catch (error) {
    console.error("❌ Approval error:", error);
    return withCors(req, {
      success: false,
      error: "Employee approval failed.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
