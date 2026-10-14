import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from "@neondatabase/serverless";
import { sendOTPEmail } from "@lib/email";
import { hit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import {
  WINDOW_MS,
  IP_LIMIT,
  RESEND_LIMIT,
  LOGIN_WINDOW_MINUTES,
  generateOTP,
  hashOTP,
  isAllowedAdminRole,
} from "@/lib/admin-otp";

const sql = neon(process.env.DATABASE_URL!);

type OTPRequestBody = {
  username?: string;
  email?: string;
};

type AdminUserRow = {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
};

export const runtime = "nodejs"; // required for SMTP

const PASSWORD_FIRST = "Sign in with your password first";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Sends a replacement OTP for a sign-in that already passed the password step.
// It never starts a sign-in: without a recent password check there is nothing to resend.
export async function POST(req: NextRequest) {
  try {
    const byIp = hit(`otp-request:ip:${clientIp(req)}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, "Too many requests. Try again later.");
    }

    const body = (await req.json()) as OTPRequestBody;
    const { username, email } = body;

    if (!username && !email) {
      return withCors(
        req,
        { success: false, message: "Username or email is required" },
        400
      );
    }

    // 1️⃣ Find admin user
    const result = await sql`
      SELECT id, username, email, role, is_active
      FROM admin_users
      WHERE username = ${username ?? null} OR email = ${email ?? null}
      LIMIT 1
    `;

    const user = result[0] as AdminUserRow | undefined;
    if (!user) {
      return withCors(
        req,
        { success: false, message: PASSWORD_FIRST },
        401
      );
    }

    // Suspended or deactivated accounts must not obtain new access
    if (!user.is_active) {
      return withCors(
        req,
        { success: false, message: "Account is not active" },
        403
      );
    }

    if (!isAllowedAdminRole(user.role)) {
      return withCors(
        req,
        { success: false, message: "Access denied: Admin privileges required" },
        403
      );
    }

    // 2️⃣ The password step leaves a row in admin_otps; its created_at is when
    // the password was verified. No recent row means no sign-in is in progress.
    const pending = await sql`
      SELECT id
      FROM admin_otps
      WHERE admin_id = ${user.id}
        AND created_at > NOW() - make_interval(mins => ${LOGIN_WINDOW_MINUTES})
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!pending[0]) {
      return withCors(
        req,
        { success: false, message: PASSWORD_FIRST },
        401
      );
    }

    const resends = hit(`otp:resend:${user.id}`, RESEND_LIMIT, WINDOW_MS);
    if (!resends.allowed) {
      return tooManyRequests(req, resends.retryAfter, "Too many codes requested. Sign in with your password again later.");
    }

    // 3️⃣ Replace the code in place, keeping created_at (expires in 5 minutes, on the database clock)
    const otp = generateOTP();
    const otpHash = hashOTP(otp);

    await sql`
      UPDATE admin_otps
      SET otp_hash = ${otpHash}, expires_at = NOW() + INTERVAL '5 minutes'
      WHERE id = ${pending[0].id}
    `;

    // 4️⃣ Send OTP via email
    try {
      await sendOTPEmail(user.email, otp);
    } catch (emailError) {
      console.error("Failed to send OTP email:", emailError);
      return withCors(
        req,
        { success: false, message: "Failed to send OTP email. Check SMTP credentials." },
        500
      );
    }

    return withCors(req, {
      success: true,
      message: "OTP has been sent to your registered email",
    });
  } catch (error) {
    console.error("OTP endpoint error details:", error);
    return withCors(
      req,
      { success: false, message: "Something went wrong. Check server logs." },
      500
    );
  }
}
