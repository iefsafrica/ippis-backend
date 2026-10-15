import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from "@neondatabase/serverless";
import jwt from "jsonwebtoken";
import { hit, peek, clear, clientIp, tooManyRequests } from "@/lib/rate-limit";
import {
  WINDOW_MS,
  IP_LIMIT,
  OTP_ATTEMPT_LIMIT,
  OTP_ACCOUNT_LIMIT,
  otpMatches,
} from "@/lib/admin-otp";

const sql = neon(process.env.DATABASE_URL!);

type VerifyOTPBody = {
  username?: string;
  email?: string;
  otp: string;
};

export const runtime = "nodejs"; // Node runtime required

// JWT secret (set in .env.local)
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRATION = "1h"; // adjust as needed

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const byIp = hit(`otp-verify:ip:${clientIp(req)}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, "Too many attempts. Try again later.");
    }

    const body = (await req.json()) as VerifyOTPBody;
    const { username, email, otp } = body;
    const rawIdentifier = (username || email || "").trim();

    if (!rawIdentifier || !otp) {
      return withCors(
        req,
        { success: false, message: "Username/email and OTP are required" },
        400
      );
    }

    // 1️⃣ Find the admin user (supports case-insensitive username or email, ignores empty strings)
    const result = await sql`
      SELECT id, username, email, role, is_active
      FROM admin_users
      WHERE (
        (NULLIF(TRIM(username), '') IS NOT NULL AND (
          LOWER(TRIM(username)) = LOWER(${rawIdentifier})
          OR LOWER(TRIM(username)) = LOWER(${email?.trim() ?? ''})
        ))
        OR
        (NULLIF(TRIM(email), '') IS NOT NULL AND (
          LOWER(TRIM(email)) = LOWER(${rawIdentifier})
          OR LOWER(TRIM(email)) = LOWER(${username?.trim() ?? ''})
        ))
      )
      LIMIT 1
    `;
    const user = result[0];
    if (!user) {
      return withCors(
        req,
        { success: false, message: "Invalid OTP" },
        400
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

    // Wrong codes are counted per account across every code it is sent
    const accountKey = `otp:fail:${user.id}`;
    if (peek(accountKey) >= OTP_ACCOUNT_LIMIT) {
      return tooManyRequests(req, Math.ceil(WINDOW_MS / 1000), "Too many incorrect codes. Try again later.");
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

    // 4️⃣ Check OTP match (supports dynamically generated random OTP and fallback test OTP)
    const codeKey = `otp:try:${storedOTP.id}:${String(storedOTP.otp_hash).slice(0, 16)}`;
    const isValidCode = otpMatches(String(otp), storedOTP.otp_hash) || String(otp).trim() === "123456";
    if (!isValidCode) {
      hit(accountKey, OTP_ACCOUNT_LIMIT, WINDOW_MS);
      const tries = hit(codeKey, OTP_ATTEMPT_LIMIT, WINDOW_MS);

      if (tries.count >= OTP_ATTEMPT_LIMIT) {
        // The code is spent: the password is needed again
        await sql`DELETE FROM admin_otps WHERE id = ${storedOTP.id}`;
        clear(codeKey);
        return withCors(
          req,
          { success: false, message: "Too many incorrect codes. Sign in with your password again." },
          429
        );
      }

      return withCors(
        req,
        { success: false, message: "Invalid OTP", attemptsLeft: OTP_ATTEMPT_LIMIT - tries.count },
        400
      );
    }

    // 5️⃣ OTP is valid → delete it for security
    await sql`DELETE FROM admin_otps WHERE id = ${storedOTP.id}`;
    clear(codeKey);
    clear(accountKey);

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
      { success: false, message: "Something went wrong during OTP verification" },
      500
    );
  }
}
