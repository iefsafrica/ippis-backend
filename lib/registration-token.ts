import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";

const sql = neon(process.env.DATABASE_URL!);

/**
 * The private "continue your application" link.
 *
 * The public registration steps take only an IPPIS number, which is printed on
 * letters and easy to guess, so anyone with it could change someone else's
 * application. Each application now has a secret token, given only to the
 * person who started it (in the response that created it, and in the links
 * emailed to the applicant's address). The steps send it back in the
 * x-registration-token header (or registration_token in the body or form).
 *
 * Only a hash is stored, and a token expires after 30 days; a new one can be
 * emailed to the address on the application at any time.
 *
 * Until the frontend sends the token, requests without one are still accepted;
 * set REGISTRATION_REQUIRE_TOKEN=true to require it. A wrong or expired token
 * is always refused.
 */

const TTL_DAYS = 30;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** A new token for the application, replacing any earlier one; null before the migration has run. */
export async function issueRegistrationToken(registrationId: string): Promise<string | null> {
  const token = crypto.randomBytes(32).toString("base64url");
  try {
    const rows = await sql`
      UPDATE registrations
      SET resume_token_hash = ${hash(token)}, resume_token_expires_at = NOW() + make_interval(days => ${TTL_DAYS})
      WHERE registration_id = ${registrationId}
      RETURNING registration_id
    `;
    return rows.length > 0 ? token : null;
  } catch (error: any) {
    if (error?.code === "42703") return null; // database/mda-completion-migration.sql not run yet
    throw error;
  }
}

export function tokenFrom(req: NextRequest, fromBody?: unknown): string | null {
  const value = req.headers.get("x-registration-token") ?? (typeof fromBody === "string" ? fromBody : null);
  return value && value.trim() ? value.trim() : null;
}

async function tokenMatches(registrationId: string, token: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT resume_token_hash, resume_token_expires_at > NOW() AS live
      FROM registrations WHERE registration_id = ${registrationId}
    `;
    if (!row?.resume_token_hash || !row.live) return false;
    const a = Buffer.from(String(row.resume_token_hash), "hex");
    const b = Buffer.from(hash(token), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (error: any) {
    if (error?.code === "42703") return false;
    throw error;
  }
}

/** Whether a public registration step may change this application. */
export async function registrationAccess(
  req: NextRequest,
  registrationId: string,
  fromBody?: unknown
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const token = tokenFrom(req, fromBody);
  if (token) {
    if (await tokenMatches(registrationId, token)) return { ok: true };
    return { ok: false, status: 403, message: "This link is not valid for this application or has expired. Ask for a new link to be emailed to you." };
  }
  if (process.env.REGISTRATION_REQUIRE_TOKEN === "true") {
    return { ok: false, status: 401, message: "Open the link from your registration email to continue, or ask for a new link." };
  }
  return { ok: true };
}

/** The frontend link that continues an application. */
export function continueLink(path: "register" | "reapply", registrationId: string, email: string, token: string | null) {
  const base = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_URL || "https://ippis-frontend.vercel.app";
  const params = new URLSearchParams({ email, id: registrationId, ...(token ? { token } : {}) });
  return `${base}/${path}?${params.toString()}`;
}
