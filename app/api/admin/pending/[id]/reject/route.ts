import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

// ✅ Check if table exists
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

// ✅ PATCH: Reject pending employee (Next.js 15–compatible)
export const PATCH = async (
  req: NextRequest,
  context: { params: Record<string, string> }
): Promise<NextResponse> => {
  try {
    console.log("Rejecting pending employee...");

    const id = context.params?.id;
    if (!id) {
      return withCors(
        req,
        { success: false, error: "Registration ID is required in URL." },
        400
      );
    }

    const registrationId = decodeURIComponent(id).trim();

    // 1️⃣ Ensure the table exists
    const pendingExists = await tableExists("pending_employees");
    if (!pendingExists) {
      return withCors(
        req,
        { success: false, error: "Table 'pending_employees' does not exist." },
        404
      );
    }

    // 2️⃣ Fetch the pending employee
    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;
    const pendingEmployee = pendingEmployeeResult[0];

    if (!pendingEmployee) {
      return withCors(
        req,
        { success: false, error: `No pending employee found with ID ${registrationId}` },
        404
      );
    }

    // 3️⃣ Delete from pending_employees
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`;

    // 4️⃣ Send rejection email if email exists
    try {
      if (pendingEmployee?.email) {
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
          text: `Hi ${pendingEmployee.firstname || "there"},\n\nWe regret to inform you that your employment application has been declined at this time.\n\nThank you for your interest.\n\n— The HR Team`,
        });

        console.log(`❌ Rejection email sent to: ${pendingEmployee.email}`);
      } else {
        console.warn("⚠️ No valid email found for rejection notice.");
      }
    } catch (emailError) {
      console.error("⚠️ Failed to send rejection email:", emailError);
    }

    // 5️⃣ Return success
    return withCors(req, {
      success: true,
      message: `Employee ${registrationId} was rejected and removed from pending list.`,
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
};
