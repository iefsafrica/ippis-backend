import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../../lib/cors";
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VerifyOTPBody;
    const { username, email, otp } = body;

    if ((!username && !email) || !otp) {
      return NextResponse.json(
        { success: false, message: "Username/email and OTP are required" },
        { status: 400 }
      );
    }

    // 1️⃣ Find the admin user
    const result = await sql`
      SELECT id, username, email, role
      FROM admin_users
      WHERE username = ${username ?? null} OR email = ${email ?? null}
      LIMIT 1
    `;
    const user = result[0];
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Admin user not found" },
        { status: 401 }
      );
    }

    // 2️⃣ Fetch OTP from DB
    const otpResult = await sql`
      SELECT id, otp_hash, expires_at
      FROM admin_otps
      WHERE admin_id = ${user.id}
      LIMIT 1
    `;
    const storedOTP = otpResult[0];

    if (!storedOTP) {
      return NextResponse.json(
        { success: false, message: "No OTP found. Request a new one." },
        { status: 400 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(storedOTP.expires_at);

    // 3️⃣ Check expiration
    if (now > expiresAt) {
      await sql`DELETE FROM admin_otps WHERE id = ${storedOTP.id}`;
      return NextResponse.json(
        { success: false, message: "OTP expired. Request a new one." },
        { status: 400 }
      );
    }

    // 4️⃣ Check OTP match
    const hashedOTP = hashOTP(otp);
    if (hashedOTP !== storedOTP.otp_hash) {
      return NextResponse.json(
        { success: false, message: "Invalid OTP" },
        { status: 400 }
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

    return NextResponse.json({
      success: true,
      message: "OTP verified successfully",
      token, // JWT token for login
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong during OTP verification",
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
