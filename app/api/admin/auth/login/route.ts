import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const sql = neon(process.env.DATABASE_URL!);

export const dynamic = 'force-dynamic'; // ensure fresh requests

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

async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: LoginRequest;

  try {
    body = (await req.json()) as LoginRequest;
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { username, email, password } = body;

  if ((!username && !email) || !password) {
    return NextResponse.json(
      { success: false, message: 'Username or email and password are required' },
      { status: 400 }
    );
  }

  // Check table
  const adminTableExists = await tableExists('admin_users');
  if (!adminTableExists) {
    return NextResponse.json(
      { success: false, message: 'Admin users table does not exist' },
      { status: 500 }
    );
  }

  // Fetch user by username OR email
  const userResult = await sql`
    SELECT id, username, email, password_hash, role
    FROM admin_users
    WHERE username = ${username ?? ''} OR email = ${email ?? ''}
  `;

  const userRows = userResult as AdminUserRow[];
  const user = userRows[0];

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'User not found with provided username or email' },
      { status: 401 }
    );
  }

  // Ensure correct login field matches
  if ((username && user.username !== username) || (email && user.email !== email)) {
    return NextResponse.json(
      { success: false, message: 'Username or email does not match our records' },
      { status: 401 }
    );
  }

  // Check password
  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    return NextResponse.json(
      { success: false, message: 'Invalid password' },
      { status: 401 }
    );
  }

  // Check role
  if (user.role !== 'admin') {
    return NextResponse.json(
      { success: false, message: 'Access denied: Admins only' },
      { status: 403 }
    );
  }

  // Success
  return NextResponse.json({
    success: true,
    message: 'Admin login successful',
    data: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/admin/auth/login',
    status: 'active',
    message: 'Admin Auth API is running',
    timestamp: new Date().toISOString(),
  });
}
