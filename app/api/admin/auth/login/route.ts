import { NextRequest } from 'next/server';
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { sendOTPEmail } from '@lib/email';
import { hit, peek, clear, clientIp, tooManyRequests } from '@/lib/rate-limit';
import {
  WINDOW_MS,
  IP_LIMIT,
  PASSWORD_FAILURE_LIMIT,
  generateOTP,
  hashOTP,
  isAllowedAdminRole,
} from '@/lib/admin-otp';

const sql = neon(process.env.DATABASE_URL!);

export const dynamic = 'force-dynamic';

type LoginRequest = {
  username?: string;
  email?: string;
  password: string;
};

type AdminUserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  is_active: boolean;
};

// Compared against when the account does not exist, so the response takes as
// long as it does for a real account. It is the hash of a discarded random value.
const UNKNOWN_ACCOUNT_HASH = '$2a$10$LOvYcqSsdQYahkhbZ7iHR.8mIzAicQRuOruboX.rRCI.r47K8wBsO';

const INVALID_CREDENTIALS = 'Invalid username or password';

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const byIp = hit(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, 'Too many sign-in attempts. Try again later.');
    }

    const body = (await req.json()) as LoginRequest;
    const { username, email, password } = body;
    const rawIdentifier = (username || email || '').trim();

    if (!rawIdentifier || !password) {
      return withCors(
        req,
        { success: false, message: 'Username/email and password are required' },
        400
      );
    }

    const failKey = `login:fail:${ip}:${rawIdentifier.toLowerCase()}`;
    if (peek(failKey) >= PASSWORD_FAILURE_LIMIT) {
      return tooManyRequests(req, Math.ceil(WINDOW_MS / 1000), 'Too many failed sign-in attempts. Try again later.');
    }

    // 1. Fetch user (supports case-insensitive username or email, ignores empty strings)
    const userResult = await sql`
      SELECT id, username, email, password_hash, role, is_active
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

    const user = userResult[0] as AdminUserRow | undefined;

    // 2. Validate password. The same answer is given whether the account or the
    // password is wrong, so the response does not reveal which usernames exist.
    const passwordValid = await bcrypt.compare(password, user?.password_hash ?? UNKNOWN_ACCOUNT_HASH);
    if (!user || !passwordValid) {
      hit(failKey, PASSWORD_FAILURE_LIMIT, WINDOW_MS);
      return withCors(
        req,
        { success: false, message: INVALID_CREDENTIALS },
        401
      );
    }

    // Suspended or deactivated accounts must not obtain new access
    if (!user.is_active) {
      return withCors(
        req,
        { success: false, message: 'Account is not active' },
        403
      );
    }

    // 3. Validate role
    if (!isAllowedAdminRole(user.role)) {
      return withCors(
        req,
        { success: false, message: 'Access denied: Admin privileges required' },
        403
      );
    }

    clear(failKey);
    // A fresh password sign-in starts a fresh allowance of resends
    clear(`otp:resend:${user.id}`);

    // 4. Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);

    // Delete existing OTPs for this admin
    await sql`DELETE FROM admin_otps WHERE admin_id = ${user.id}`;

    // Store new OTP (expires in 5 minutes). created_at marks when the password
    // was verified; request-otp only resends while that is recent.
    await sql`
      INSERT INTO admin_otps (admin_id, otp_hash, expires_at)
      VALUES (
        ${user.id},
        ${otpHash},
        NOW() + INTERVAL '5 minutes'
      )
    `;

    // 5. Send OTP email (catches failures so SMTP blocks do not crash the sign-in)
    try {
      await sendOTPEmail(user.email, otp);
    } catch (emailErr) {
      console.error('[Login] Failed to send OTP email:', emailErr);
    }

    return withCors(req, {
      success: true,
      message: 'OTP sent to your registered email.',
      requiresOTP: true
    });

  } catch (error) {
    console.error('Login error:', error);
    return withCors(
      req,
      { success: false, message: 'Something went wrong during login' },
      500
    );
  }
}

export async function GET(req: NextRequest) {
  return withCors(req, {
    endpoint: '/api/admin/auth/login',
    status: 'active',
    message: 'Admin Auth API is running',
    timestamp: new Date().toISOString(),
  });
}
