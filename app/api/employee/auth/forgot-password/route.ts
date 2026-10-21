import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { WINDOW_MS, IP_LIMIT } from "@/lib/admin-otp";
import { newLinkToken, portalLink, RESET_VALID_MINUTES } from "@/lib/employee-auth";
import { sendEmployeePasswordResetEmail } from "@lib/email";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// Reset emails one account can be sent per window
const RESET_EMAIL_LIMIT = 3;

// The same answer whatever happens, so this cannot be used to find out who has an account
const ANSWER = "If an active account matches, a password reset link has been sent to its email.";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Body: { identifier: staff ID or email }
export async function POST(req: NextRequest) {
  try {
    const byIp = hit(`employee-forgot:ip:${clientIp(req)}`, IP_LIMIT, WINDOW_MS);
    if (!byIp.allowed) {
      return tooManyRequests(req, byIp.retryAfter, "Too many requests. Try again later.");
    }

    const body = (await req.json().catch(() => ({}))) as { identifier?: string; staff_id?: string; email?: string };
    const identifier = String(body.identifier ?? body.staff_id ?? body.email ?? "").trim();
    if (!identifier) {
      return withCors(req, { success: false, message: "Staff ID or email is required" }, 400);
    }

    const rows = await db`
      SELECT e.id, e.name, e.email
      FROM employees e
      JOIN employee_accounts a ON a.employee_id = e.id
      WHERE (e.id = ${identifier} OR LOWER(e.email) = LOWER(${identifier}))
        AND a.status = 'active'
        AND LOWER(e.status) = 'active'
      LIMIT 1
    `;
    const employee = rows[0];

    if (employee && hit(`employee-forgot:account:${employee.id}`, RESET_EMAIL_LIMIT, WINDOW_MS).allowed) {
      const { token, hash } = newLinkToken();
      await db`
        UPDATE employee_accounts
        SET reset_token_hash = ${hash},
            reset_expires_at = NOW() + make_interval(mins => ${RESET_VALID_MINUTES}),
            updated_at = NOW()
        WHERE employee_id = ${employee.id}
      `;
      try {
        await sendEmployeePasswordResetEmail(String(employee.email), String(employee.name), portalLink("reset-password", token));
      } catch (emailError) {
        // Logged for the operators; the caller still gets the neutral answer
        console.error("EMPLOYEE RESET EMAIL ERROR:", emailError);
      }
    }

    return withCors(req, { success: true, message: ANSWER });
  } catch (error) {
    console.error("EMPLOYEE FORGOT PASSWORD ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong. Try again." }, 500);
  }
}
