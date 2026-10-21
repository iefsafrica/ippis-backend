import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, peek, clear, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { WINDOW_MS, IP_LIMIT, PASSWORD_FAILURE_LIMIT } from "@/lib/admin-otp";
import { signEmployeeToken } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// Compared against when there is no usable account, so every failure takes the same time
const NO_ACCOUNT_HASH = "$2a$10$LOvYcqSsdQYahkhbZ7iHR.8mIzAicQRuOruboX.rRCI.r47K8wBsO";
const INVALID_CREDENTIALS = "Invalid staff ID, email or password";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { identifier: staff ID or email, password }
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const byIp = hit(`employee-login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, "Too many sign-in attempts. Try again later.");
    }

    const body = (await req.json().catch(() => ({}))) as { identifier?: string; staff_id?: string; email?: string; password?: string };
    const identifier = String(body.identifier ?? body.staff_id ?? body.email ?? "").trim();
    const password = body.password;

    if (!identifier || typeof password !== "string" || !password) {
      return withCors(req, { success: false, message: "Staff ID or email, and password, are required" }, 400);
    }

    const failKey = `employee-login:fail:${ip}:${identifier.toLowerCase()}`;
    if (peek(failKey) >= PASSWORD_FAILURE_LIMIT) {
      return tooManyRequests(req, Math.ceil(WINDOW_MS / 1000), "Too many failed sign-in attempts. Try again later.");
    }

    const rows = await db`
      SELECT e.id, e.name, e.email, e.department, e.position, e.status AS employee_status,
             a.status AS account_status, a.password_hash, a.token_version
      FROM employees e
      JOIN employee_accounts a ON a.employee_id = e.id
      WHERE e.id = ${identifier} OR LOWER(e.email) = LOWER(${identifier})
      LIMIT 1
    `;
    const account = rows[0];

    const valid = await bcrypt.compare(password, account?.password_hash ?? NO_ACCOUNT_HASH);
    if (!account || !account.password_hash || !valid) {
      hit(failKey, PASSWORD_FAILURE_LIMIT, WINDOW_MS);
      return withCors(req, { success: false, message: INVALID_CREDENTIALS }, 401);
    }

    // Right password, but access has been withdrawn
    if (account.account_status !== "active" || String(account.employee_status).toLowerCase() !== "active") {
      return withCors(req, { success: false, message: "Account is not active. Contact HR." }, 403);
    }

    clear(failKey);
    await db`UPDATE employee_accounts SET last_login_at = NOW() WHERE employee_id = ${account.id}`;

    return withCors(req, {
      success: true,
      message: "Signed in successfully",
      token: signEmployeeToken(String(account.id), Number(account.token_version)),
      employee: {
        id: account.id,
        name: account.name,
        email: account.email,
        department: account.department,
        position: account.position,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE LOGIN ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong during sign-in" }, 500);
  }
}
