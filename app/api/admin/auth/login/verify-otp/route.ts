import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const sql = neon(process.env.DATABASE_URL!);

type VerifyOTPBody = {
  username?: string;
  email?: string;
  otp: string;
};

export const runtime = "nodejs"; // Node runtime required

function hashOTP(otp: string) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

// JWT secret (set in .env.local)
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRATION = "1h"; // adjust as needed

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VerifyOTPBody;
    const { username, email, otp } = body;

    if ((!username && !email) || !otp) {
      return withCors(
        req,
        { success: false, message: "Username/email and OTP are required" },
        400
      );
    }

    // 1️⃣ Find the admin user
    const result = await sql`
      SELECT id, username, email, role, is_active
      FROM admin_users
      WHERE username = ${username ?? null} OR email = ${email ?? null}
      LIMIT 1
    `;
    const user = result[0];
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

    // 2️⃣ Fetch OTP from DB
    // Expiry is compared in the database: expires_at has no time zone, so
    // reading it into a JS Date would shift it by the server's UTC offset.
    const otpResult = await sql`
      SELECT id, otp_hash, (expires_at <= NOW()) AS expired
      FROM admin_otps
      WHERE admin_id = ${user.id}
      LIMIT 1
    `;
    const storedOTP = otpResult[0];

    if (!storedOTP) {
      return withCors(
        req,
        { success: false, message: "No OTP found. Request a new one." },
        400
      );
    }

    // 3️⃣ Check expiration
    if (storedOTP.expired) {
      await sql`DELETE FROM admin_otps WHERE id = ${storedOTP.id}`;
      return withCors(
        req,
        { success: false, message: "OTP expired. Request a new one." },
        400
      );
    }

    // 4️⃣ Check OTP match
    const hashedOTP = hashOTP(otp);
    if (hashedOTP !== storedOTP.otp_hash) {
      return withCors(
        req,
        { success: false, message: "Invalid OTP" },
        400
      );
    }

    // 5️⃣ OTP is valid → delete it for security
    await sql`DELETE FROM admin_otps WHERE id = ${storedOTP.id}`;

    // 6️⃣ Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRATION }
    );

    return withCors(req, {
      success: true,
      message: "OTP verified successfully",
      token, // JWT token for login
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return withCors(
      req,
      {
        success: false,
        message: "Something went wrong during OTP verification",
        error: (error as Error).message,
      },
      500
    );
  }
}
