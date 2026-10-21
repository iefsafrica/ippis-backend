import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { generateResetToken } from "@/lib/password-utils";
import { sendPasswordResetEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * POST /api/admin/auth/forgot-password
 *
 * Requests a password reset link for an admin or applicant account.
 * - Checks admin_users; employees and pending records only fill in the email's name and status
 * - Only existing admin_users accounts get a link; none is created here
 * - Generates secure 64-char token valid for 60 minutes
 * - Sends official Nigerian Government IPPIS branded HTML email
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const rawEmail = body.email || body.identifier;

    if (!rawEmail || typeof rawEmail !== "string") {
      return withCors(
        req,
        { success: false, error: "Please provide a valid email address." },
        400
      );
    }

    const email = rawEmail.trim().toLowerCase();

    // 1. Check in admin_users
    let adminUser: any = null;
    const adminUserRows = await sql`
      SELECT id, username, email, full_name, role, status, staff_id, is_active
      FROM admin_users
      WHERE LOWER(email) = ${email} OR LOWER(username) = ${email}
      LIMIT 1
    `;
    if (adminUserRows.length > 0) {
      adminUser = adminUserRows[0];
    }

    // 2. Check in employees table (Active employees)
    let activeEmployee: any = null;
    const empRows = await sql`
      SELECT id, name, email, department, position, status, created_at
      FROM employees
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (empRows.length > 0) {
      activeEmployee = empRows[0];
    }

    // 3. Check in pending_employees (Pending employees / applicants)
    let pendingEmployee: any = null;
    const pendingRows = await sql`
      SELECT id, registration_id, firstname, surname, email, department, position, created_at
      FROM pending_employees
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (pendingRows.length > 0) {
      pendingEmployee = pendingRows[0];
    }

    // 4. Check in personal_info (Applicants who submitted form)
    let applicantInfo: any = null;
    if (!activeEmployee && !pendingEmployee) {
      const pRows = await sql`
        SELECT id, registration_id, first_name, surname, email, phone_number
        FROM personal_info
        WHERE LOWER(email) = ${email}
        ORDER BY id DESC
        LIMIT 1
      `;
      if (pRows.length > 0) {
        applicantInfo = pRows[0];
      }
    }

    // If user not found in any table
    if (!adminUser && !activeEmployee && !pendingEmployee && !applicantInfo) {
      console.log(`[Forgot Password] Requested for unregistered email: ${email}`);
      // Return success with generic message for privacy/security
      return withCors(req, {
        success: true,
        message: "If an IPPIS record exists for this email address, password reset instructions have been sent.",
      });
    }

    // Determine metadata
    const isPending = Boolean(pendingEmployee || applicantInfo || adminUser?.role === "applicant");
    const fullName =
      adminUser?.full_name ||
      activeEmployee?.name ||
      (pendingEmployee ? `${pendingEmployee.firstname || ""} ${pendingEmployee.surname || ""}`.trim() : "") ||
      (applicantInfo ? `${applicantInfo.first_name || ""} ${applicantInfo.surname || ""}`.trim() : "") ||
      "IPPIS User";

    const employeeId =
      adminUser?.staff_id ||
      activeEmployee?.id ||
      pendingEmployee?.registration_id ||
      applicantInfo?.registration_id ||
      undefined;

    const statusLabel = isPending
      ? "Pending Employment Application"
      : "Active IPPIS Employee";

    // Only existing admin accounts are reset here. No account is created from this
    // public form: employees reset their portal password through
    // /api/employee/auth/forgot-password, and the answer stays the same so the
    // form does not reveal who has an account.
    if (!adminUser) {
      console.log(`[Forgot Password] No admin account for ${email}; nothing sent`);
      return withCors(req, {
        success: true,
        message: "If an IPPIS record exists for this email address, password reset instructions have been sent.",
      });
    }
    const adminUserId = Number(adminUser.id);

    // Generate secure token and 60-minute expiry
    const token = generateResetToken();
    const expiresInMinutes = 60;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Store in password_reset_tokens
    await sql`
      INSERT INTO password_reset_tokens (user_id, token, email, expires_at, created_at)
      VALUES (${adminUserId}, ${token}, ${email}, ${expiresAt}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        token = EXCLUDED.token,
        email = EXCLUDED.email,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
    `;

    // Construct reset link
    const frontendUrl =
      process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app";
    const resetUrl = `${frontendUrl}/admin/reset-password`;

    // Send official HTML password reset email
    await sendPasswordResetEmail({
      to: email,
      fullName,
      resetUrl,
      token,
      employeeId,
      isPending,
      statusLabel,
      expiresInMinutes,
    }).catch((err) => {
      console.error("[Forgot Password] Email send failure:", err);
    });

    console.log(`[Forgot Password] Successfully issued reset token for ${email} (${statusLabel})`);

    return withCors(req, {
      success: true,
      message: `Password reset instructions have been sent to ${email}. Please check your inbox.`,
    });
  } catch (error: any) {
    console.error("[Forgot Password Route Error]:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to process password reset request. Please try again later.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
