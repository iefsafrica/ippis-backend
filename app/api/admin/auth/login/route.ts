import { NextRequest } from 'next/server';
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; 
import { sendOTPEmail } from '@lib/email';

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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOTP(otp: string) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function isAllowedAdminRole(role: string) {
  const normalizedRole = role.replace(/\s+/g, '').toLowerCase();
  return ['admin', 'superadmin'].includes(normalizedRole);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LoginRequest;
    const { username, email, password } = body;

    if ((!username && !email) || !password) {
      return withCors(
        req,
        { success: false, message: 'Username/email and password are required' },
        400
      );
    }

    // 1?? Fetch user
    const userResult = await sql`
      SELECT id, username, email, password_hash, role, is_active
      FROM admin_users
      WHERE username = ${username ?? ''} OR email = ${email ?? ''}
      LIMIT 1
    `;

    const user = userResult[0] as AdminUserRow | undefined;

    if (!user) {
      return withCors(
        req,
        { success: false, message: 'User not found' },
        401
      );
    }

    // 2?? Validate password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return withCors(
        req,
        { success: false, message: 'Invalid password' },
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

    // 3?? Validate role
    if (!isAllowedAdminRole(user.role)) {
      return withCors(
        req,
        { success: false, message: 'Access denied: Admin privileges required' },
        403
      );
    }

    // 4?? Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);

    // Delete existing OTPs for this admin
    await sql`DELETE FROM admin_otps WHERE admin_id = ${user.id}`;

    // Store new OTP (expires in 5 minutes)
    await sql`
      INSERT INTO admin_otps (admin_id, otp_hash, expires_at)
      VALUES (
        ${user.id},
        ${otpHash},
        NOW() + INTERVAL '5 minutes'
      )
    `;

    // 5?? Send OTP email
    await sendOTPEmail(user.email, otp);

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
