import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from "../../../../../lib/cors";
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LoginRequest;
    const { username, email, password } = body;

    if ((!username && !email) || !password) {
      return NextResponse.json(
        { success: false, message: 'Username/email and password are required' },
        { status: 400 }
      );
    }

    // 1️⃣ Fetch user
    const userResult = await sql`
      SELECT id, username, email, password_hash, role
      FROM admin_users
      WHERE username = ${username ?? ''} OR email = ${email ?? ''}
      LIMIT 1
    `;

    const user = userResult[0] as AdminUserRow | undefined;

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 401 }
      );
    }

    // 2️⃣ Validate password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { success: false, message: 'Invalid password' },
        { status: 401 }
      );
    }

    // 3️⃣ Validate role
    if (!isAllowedAdminRole(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied: Admin privileges required' },
        { status: 403 }
      );
    }

    // 4️⃣ Generate OTP
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

    // 5️⃣ Send OTP email
    await sendOTPEmail(user.email, otp);

    return NextResponse.json({
      success: true,
      message: 'OTP sent to your registered email.',
      requiresOTP: true
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: 'Something went wrong during login' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/admin/auth/login',
    status: 'active',
    message: 'Admin Auth API is running',
    timestamp: new Date().toISOString(),
  });
}
