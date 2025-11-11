import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

// Neon client
const sql = neon(process.env.DATABASE_URL!);

// ✅ Helper: check if table exists
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
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error);
    return false;
  }
}

// ✅ Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ✅ PATCH: Reject pending employee (Next.js build-safe)
export async function PATCH(req: NextRequest) {
  try {
    console.log("Rejecting pending employee...");

    // ✅ Extract registration ID safely from URL
    const url = new URL(req.url);
    // URL looks like /api/admin/pending/[id]/reject
    const pathParts = url.pathname.split("/");
    const registrationId = decodeURIComponent(
      pathParts[pathParts.length - 2] || ""
    ).trim();

    if (!registrationId) {
      return withCors(
        req,
        { success: false, error: "Registration ID is required in the URL." },
        400
      );
    }

    // ✅ Ensure pending_employees table exists
    const pendingExists = await tableExists("pending_employees");
    if (!pendingExists) {
      return withCors(
        req,
        {
          success: false,
          error: "pending_employees table does not exist.",
        },
        404
      );
    }

    // ✅ Fetch pending employee
    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;
    const pendingEmployee = pendingEmployeeResult[0];

    if (!pendingEmployee) {
      return withCors(
        req,
        {
          success: false,
          error: `Pending employee with registration ID ${registrationId} not found.`,
        },
        404
      );
    }

    // ✅ Delete from pending_employees
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`;

    // ✅ Combine surname + firstname → full name
    const fullName =
      `${pendingEmployee.surname ?? ""} ${pendingEmployee.firstname ?? ""}`.trim() ||
      "Employee";

    // ✅ Send rejection email
    try {
      if (pendingEmployee.email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.SMTP_USER!,
            pass: process.env.SMTP_PASS!,
          },
        });

        await transporter.sendMail({
          from: `"HR Department" <${process.env.SMTP_USER}>`,
          to: pendingEmployee.email,
          subject: "Your Employment Application Status",
          text: `Hi ${fullName},\n\nWe regret to inform you that your employment application has not been approved at this time.\n\nThank you for your interest, and we wish you the best in your future endeavors.\n\n— The HR Team`,
        });

        console.log(`✅ Rejection email sent to: ${pendingEmployee.email}`);
      } else {
        console.warn("⚠️ Skipping rejection email — no valid email found.");
      }
    } catch (emailError) {
      console.error("⚠️ Failed to send rejection email:", emailError);
    }

    // ✅ Return success response
    return withCors(req, {
      success: true,
      message: `Pending employee ${registrationId} has been rejected and removed from the pending list.`,
      data: {
        registration_id: registrationId,
        name: fullName,
        email: pendingEmployee.email,
      },
    });
  } catch (error) {
    console.error("❌ Error rejecting employee:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to reject employee.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
