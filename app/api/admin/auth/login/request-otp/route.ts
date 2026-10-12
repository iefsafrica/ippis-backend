import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";
import { sendOTPEmail } from "@lib/email";

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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOTP(otp: string) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function isAllowedAdminRole(role: string) {
  const normalizedRole = role.replace(/\s+/g, "").toLowerCase();
  return ["admin", "superadmin"].includes(normalizedRole);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
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
        { success: false, message: "Admin user not found" },
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

    // 2️⃣ Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);

    // 3️⃣ Remove any previous OTPs
    await sql`
      DELETE FROM admin_otps
      WHERE admin_id = ${user.id}
    `;

    // 4️⃣ Store new OTP hashed in DB (expires in 5 minutes, on the database clock)
    await sql`
      INSERT INTO admin_otps (admin_id, otp_hash, expires_at)
      VALUES (${user.id}, ${otpHash}, NOW() + INTERVAL '5 minutes')
    `;

    // 5️⃣ Send OTP via email
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
      {
        success: false,
        message: "Something went wrong. Check server logs.",
        error: (error as Error).message,
      },
      500
    );
  }
}
