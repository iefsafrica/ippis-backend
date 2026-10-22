import { NextRequest } from 'next/server';
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
import { computeAccessibleModules } from '@/lib/user-management';

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
  full_name?: string;
  staff_id?: string;
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

    // 1. Fetch user (supports case-insensitive username, email, or staff_id)
    const userResult = await sql`
      SELECT id, username, email, password_hash, role, is_active, full_name, staff_id
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
        OR
        (NULLIF(TRIM(staff_id), '') IS NOT NULL AND (
          LOWER(TRIM(staff_id)) = LOWER(${rawIdentifier})
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
    clear(`otp:resend:${user.id}`);

    // Fetch user's active assigned roles and accessible modules
    const userRoles = await sql`
      SELECT r.id, r.key, r.name, ur.scope_level, ur.company_id, ur.department_id
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
      WHERE ur.user_id = ${String(user.id)}
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      ORDER BY r.name ASC
    `;

    const primaryRole = userRoles[0];
    const roleKey = primaryRole?.key || (user.role || 'admin');
    const roleName = primaryRole?.name || (user.role === 'superadmin' ? 'Super Administrator' : (user.role === 'employee' ? 'Employee' : 'Administrator'));

    const accessibleModules = computeAccessibleModules(
      userRoles.map((r: any) => ({
        id: Number(r.id),
        key: r.key ? String(r.key) : null,
        name: String(r.name),
        scope_level: r.scope_level ? String(r.scope_level) : null,
      }))
    );

    const modules = accessibleModules.length > 0 ? accessibleModules : [
      'dashboard',
      'overview',
      'profile',
      'self-service',
      'payroll',
      'attendance',
      'leave',
      'tasks',
    ];

    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_change_in_prod';
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: roleKey,
        role_name: roleName,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return withCors(req, {
      success: true,
      message: 'Signed in successfully',
      token,
      requiresOTP: false,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name || user.username,
        role: roleName,
        role_key: roleKey,
        accessible_modules: modules,
      },
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
