import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { hashPassword, validatePasswordStrength } from "@/lib/password-utils";
import { sendPasswordChangedEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * GET /api/admin/auth/reset-password?token=...
 *
 * Verifies if a reset token is valid and not yet expired.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return withCors(req, { valid: false, error: "Missing password reset token." }, 400);
    }

    const rows = await sql`
      SELECT prt.id, prt.user_id, prt.email, prt.expires_at,
             u.full_name, u.username, u.email as user_email, u.role
      FROM password_reset_tokens prt
      JOIN admin_users u ON u.id = prt.user_id
      WHERE prt.token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return withCors(
        req,
        { valid: false, error: "Invalid password reset link. It may have been used or replaced." },
        404
      );
    }

    const record = rows[0] as any;
    const isExpired = new Date(record.expires_at) < new Date();

    if (isExpired) {
      return withCors(
        req,
        { valid: false, error: "This password reset link has expired. Please request a new one." },
        410
      );
    }

    // Mask email for display: j***e@domain.gov.ng
    const emailStr = record.user_email || record.email || "";
    const [local, domain] = emailStr.split("@");
    const masked = local.length > 2
      ? `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}@${domain}`
      : emailStr;

    return withCors(req, {
      valid: true,
      email: masked,
      fullName: record.full_name || record.username,
      role: record.role,
    });
  } catch (error: any) {
    console.error("[Reset Password Verify Error]:", error);
    return withCors(
      req,
      { valid: false, error: "Failed to verify reset token.", details: error.message },
      500
    );
  }
}

/**
 * POST /api/admin/auth/reset-password
 *
 * Resets the password using the verified token.
 * Validates password strength, updates password_hash, removes token,
 * and sends an official confirmation HTML email.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const { token, newPassword, confirmPassword } = body;

    if (!token || typeof token !== "string") {
      return withCors(req, { success: false, error: "Reset token is required." }, 400);
    }

    if (!newPassword || typeof newPassword !== "string") {
      return withCors(req, { success: false, error: "New password is required." }, 400);
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return withCors(req, { success: false, error: "Passwords do not match." }, 400);
    }

    // Validate strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return withCors(req, { success: false, error: validation.message }, 400);
    }

    // Check token existence and validity
    const tokenRows = await sql`
      SELECT prt.id, prt.user_id, prt.email, prt.expires_at,
             u.id as user_id_val, u.email as user_email, u.full_name, u.username
      FROM password_reset_tokens prt
      JOIN admin_users u ON u.id = prt.user_id
      WHERE prt.token = ${token}
      LIMIT 1
    `;

    if (tokenRows.length === 0) {
      return withCors(
        req,
        { success: false, error: "Invalid or previously used reset token. Please request a new link." },
        400
      );
    }

    const record = tokenRows[0] as any;
    const isExpired = new Date(record.expires_at) < new Date();
    if (isExpired) {
      return withCors(
        req,
        { success: false, error: "This password reset token has expired. Please request a new link." },
        400
      );
    }

    // Hash the new password with bcrypt
    const passwordHash = await hashPassword(newPassword);

    // Update admin_users record
    await sql`
      UPDATE admin_users
      SET password_hash = ${passwordHash},
          status = 'active',
          is_active = true,
          updated_at = NOW()
      WHERE id = ${record.user_id_val}
    `;

    // Delete the used token
    await sql`
      DELETE FROM password_reset_tokens
      WHERE user_id = ${record.user_id_val} OR token = ${token}
    `;

    // Send confirmation email
    const recipientEmail = record.user_email || record.email;
    const recipientName = record.full_name || record.username || "IPPIS User";

    sendPasswordChangedEmail({
      to: recipientEmail,
      fullName: recipientName,
    }).catch((emailErr) => {
      console.error("[Reset Password] Confirmation email failed:", emailErr);
    });

    console.log(`[Reset Password] Successfully updated password for user ID ${record.user_id_val} (${recipientEmail})`);

    return withCors(req, {
      success: true,
      message: "Your password has been reset successfully. You may now sign in with your new password.",
    });
  } catch (error: any) {
    console.error("[Reset Password Execution Error]:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to reset password. Please try again.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
