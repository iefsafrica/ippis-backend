import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { buildRegistrationIdVariants } from "@/lib/registration-id";
import { isApprovedApplication } from "@/lib/registration-lock";
import { issueRegistrationToken, continueLink } from "@/lib/registration-token";
import { sendEmployeeRegistrationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

const WINDOW_MS = 60 * 60 * 1000;
const ANSWER = "If an application matches, a new link to continue it has been sent to the email address on it.";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function findApplication(registrationId: string | null, email: string) {
  const byEmail = await sql`
    SELECT r.registration_id
    FROM registrations r
    WHERE EXISTS (SELECT 1 FROM pending_employees p WHERE p.registration_id = r.registration_id AND LOWER(p.email) = ${email})
       OR EXISTS (SELECT 1 FROM personal_info p WHERE p.registration_id = r.registration_id AND LOWER(p.email) = ${email})
       OR EXISTS (SELECT 1 FROM "VerificationData" v WHERE v.registration_id IN (r.id::text, r.registration_id) AND LOWER(v.email) = ${email})
    ORDER BY r.updated_at DESC NULLS LAST
  `;
  const ids = byEmail.map((r: any) => String(r.registration_id));
  if (!registrationId) return ids[0] ?? null;
  // With a number, the email must be one already on that application
  const variants = buildRegistrationIdVariants(registrationId);
  return ids.find((id) => variants.includes(id)) ?? null;
}

// Body: { email, registration_id? }
// Emails a new private link to continue an application, to an address already
// on it. The answer is the same whether or not one matches.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; registration_id?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const registrationId = typeof body.registration_id === "string" && body.registration_id.trim() ? body.registration_id.trim() : null;
    if (!email || !email.includes("@")) {
      return withCors(req, { success: false, error: "email is required" }, 400);
    }

    const byIp = hit(`resume-link:ip:${clientIp(req)}`, 10, WINDOW_MS);
    if (!byIp.allowed) return tooManyRequests(req, byIp.retryAfter, "Too many requests. Try again later.");
    const byEmail = hit(`resume-link:email:${email}`, 3, WINDOW_MS);
    if (!byEmail.allowed) return tooManyRequests(req, byEmail.retryAfter, "Too many requests for this email. Try again later.");

    const found = await findApplication(registrationId, email);
    if (found && !(await isApprovedApplication(found))) {
      const token = await issueRegistrationToken(found);
      if (token) {
        const [names] = await sql`
          SELECT COALESCE(p.firstname || ' ' || p.surname, pi.first_name || ' ' || pi.surname) AS name
          FROM registrations r
          LEFT JOIN pending_employees p ON p.registration_id = r.registration_id
          LEFT JOIN personal_info pi ON pi.registration_id = r.registration_id
          WHERE r.registration_id = ${found}
        `;
        await sendEmployeeRegistrationEmail({
          to: email,
          fullName: names?.name?.trim() || "Applicant",
          registrationId: found,
          onboardingUrl: continueLink("register", found, email, token),
        }).catch((error) => console.error("RESUME LINK EMAIL ERROR:", error));
      }
    }
    return withCors(req, { success: true, message: ANSWER });
  } catch (error) {
    console.error("RESUME LINK ERROR:", error);
    return withCors(req, { success: false, error: "Could not send the link right now" }, 500);
  }
}
