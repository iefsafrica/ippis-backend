import crypto from "crypto";
import jwt from "jsonwebtoken";
import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors } from "@/lib/cors";
import { readToken } from "@/lib/rbac";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Employee self-service authentication.
 *
 * Employees are not admin users: they hold no roles, and every employee
 * portal route returns only the signed-in employee's own records. Their
 * tokens carry typ "employee", which lib/rbac.ts refuses, so an employee
 * token never opens an admin route.
 */

export const EMPLOYEE_TOKEN_TYPE = "employee";
const TOKEN_LIFETIME = "8h";

export const INVITE_VALID_HOURS = 48;
export const RESET_VALID_MINUTES = 60;

export type EmployeeContext = {
  accountId: number;
  employee: {
    id: string;
    name: string;
    email: string;
    department: string | null;
    position: string | null;
    status: string;
    registrationId: string | null;
    joinDate: string | null;
  };
};

export type EmployeeAuthResult =
  | { ok: true; ctx: EmployeeContext }
  | { ok: false; response: ReturnType<typeof withCors> };

function deny(req: NextRequest, status: number, error: string) {
  return withCors(req, { success: false, error }, status);
}

/** `version` is the account's token_version; raising it in the database ends the session. */
export function signEmployeeToken(employeeId: string, version: number) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ sub: employeeId, typ: EMPLOYEE_TOKEN_TYPE, ver: version }, secret, {
    algorithm: "HS256",
    expiresIn: TOKEN_LIFETIME,
  });
}

/**
 * Verifies an employee portal token and confirms the account and the
 * employee record are both still active. Usage:
 *
 *   const auth = await authenticateEmployee(req);
 *   if (!auth.ok) return auth.response;
 *   const employeeId = auth.ctx.employee.id;
 */
export async function authenticateEmployee(req: NextRequest): Promise<EmployeeAuthResult> {
  const token = readToken(req);
  if (!token) return { ok: false, response: deny(req, 401, "Authentication required") };

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("EMPLOYEE AUTH ERROR: JWT_SECRET is not set");
    return { ok: false, response: deny(req, 500, "Server authentication is not configured") };
  }

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") throw new Error("Unexpected token payload");
    payload = decoded;
  } catch {
    return { ok: false, response: deny(req, 401, "Invalid or expired token") };
  }

  if (payload.typ !== EMPLOYEE_TOKEN_TYPE || typeof payload.sub !== "string" || !payload.sub) {
    return { ok: false, response: deny(req, 401, "Invalid or expired token") };
  }

  try {
    const rows = await sql`
      SELECT a.id AS account_id, a.status AS account_status, a.token_version,
             e.id, e.name, e.email, e.department, e.position, e.status,
             e.registration_id, e.join_date::date::text AS join_date
      FROM employee_accounts a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.employee_id = ${payload.sub}
    `;
    const row = rows[0];

    if (!row || row.account_status !== "active" || String(row.status).toLowerCase() !== "active") {
      return { ok: false, response: deny(req, 401, "Account is not active") };
    }
    if (payload.ver !== Number(row.token_version)) {
      return { ok: false, response: deny(req, 401, "Session has ended. Please sign in again.") };
    }

    return {
      ok: true,
      ctx: {
        accountId: Number(row.account_id),
        employee: {
          id: String(row.id),
          name: String(row.name),
          email: String(row.email),
          department: row.department ?? null,
          position: row.position ?? null,
          status: String(row.status),
          registrationId: row.registration_id ?? null,
          joinDate: row.join_date ?? null,
        },
      },
    };
  } catch (error) {
    // Deny rather than guess when the account cannot be checked
    console.error("EMPLOYEE AUTH ERROR:", error);
    return { ok: false, response: deny(req, 503, "Sign-in is unavailable") };
  }
}

/** A one-time link token: the raw value goes in the email, only its hash is stored. */
export function newLinkToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Builds a link into the employee portal on the frontend. */
export function portalLink(path: string, token: string) {
  const base = (process.env.EMPLOYEE_PORTAL_URL || "https://ippis-frontend.vercel.app/employee").replace(/\/+$/, "");
  return `${base}/${path}?token=${encodeURIComponent(token)}`;
}

/** Returns why a password is not acceptable, or null when it is. */
export function passwordProblem(password: unknown, employee: { id: string; email: string }): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain both letters and numbers";
  }
  const lower = password.toLowerCase();
  const localPart = employee.email.split("@")[0]?.toLowerCase() ?? "";
  if (lower.includes(employee.id.toLowerCase()) || (localPart.length >= 4 && lower.includes(localPart))) {
    return "Password must not contain your staff ID or email name";
  }
  if (["password1", "password123", "12345678a", "qwerty123", "abc12345"].includes(lower)) {
    return "Password is too common";
  }
  return null;
}

/**
 * Audit entry for something an employee did themselves. actor_id is prefixed
 * so employee actions are never confused with admin user ids.
 */
export function employeeAuditStatement(
  req: NextRequest,
  employee: { id: string; name: string },
  action: string,
  details: Record<string, unknown> = {}
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  return sql`
    INSERT INTO audit_logs (actor_id, actor_username, action, target_type, target_id, details, ip_address)
    VALUES (
      ${`employee:${employee.id}`},
      ${employee.name.slice(0, 50)},
      ${action},
      'employee',
      ${employee.id},
      ${JSON.stringify(details)}::jsonb,
      ${ip}
    )
  `;
}
