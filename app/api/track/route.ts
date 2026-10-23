import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { hit, peek, clientIp, tooManyRequests } from "@/lib/rate-limit";
import {
  buildRegistrationIdVariants,
  normalizeRegistrationId,
} from "@/lib/registration-id";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Public application tracking: an applicant checks where their registration
 * stands. No sign-in, so it answers with the status only, never personal,
 * identity (NIN/NIMC) or document data.
 *
 * Look up by IPPIS (registration) number, email, or both. When both are sent
 * they must belong to the same application, and only then is the applicant's
 * first name included. A lookup by email alone does not reveal the IPPIS
 * number. Set TRACK_REQUIRE_EMAIL=true once the tracking page
 * sends both, to refuse lookups by one of them alone.
 *
 * Employees already approved are pointed to the employee portal.
 */

const WINDOW_MS = 15 * 60 * 1000;
const LOOKUPS_PER_IP = 30;
const MISSES_PER_IP = 10;
const NOT_FOUND = "Application not found. Check the IPPIS number and email you registered with.";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

type Found = {
  type: "registration" | "pending_employee" | "employee";
  registrationId: string | null;
  status: string;
  currentStep: string | null;
  dates: { created_at: unknown; submitted_at: unknown; approved_at: unknown; rejected_at: unknown };
  emails: string[];
  firstName: string | null;
};

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

async function registrationById(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`SELECT * FROM registrations WHERE registration_id = ${candidate} LIMIT 1`;
    if (rows[0]) return rows[0];
  }
  const stripped = inputId.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!stripped) return null;
  const rows = await sql`
    SELECT * FROM registrations
    WHERE regexp_replace(upper(registration_id), '[^A-Z0-9]', '', 'g') = ${stripped}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function pendingById(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`SELECT * FROM pending_employees WHERE registration_id = ${candidate} LIMIT 1`;
    if (rows[0]) return rows[0];
  }
  return null;
}

async function employeeById(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`SELECT id, registration_id, name, email, status FROM employees WHERE id = ${candidate} OR registration_id = ${candidate} LIMIT 1`;
    if (rows[0]) return rows[0];
  }
  return null;
}

async function fromRegistration(r: any): Promise<Found> {
  // VerificationData links by registrations.id on older rows and by the IPPIS number on newer ones
  const [verification, personal] = await Promise.all([
    sql`SELECT email, firstname FROM "VerificationData" WHERE registration_id = ${String(r.id)} OR registration_id = ${r.registration_id} LIMIT 1`,
    sql`SELECT email, first_name FROM personal_info WHERE registration_id = ${r.registration_id} LIMIT 1`,
  ]);
  return {
    type: "registration",
    registrationId: r.registration_id,
    status: r.status,
    currentStep: r.current_step ?? null,
    dates: { created_at: r.created_at, submitted_at: r.submitted_at, approved_at: r.approved_at, rejected_at: r.rejected_at },
    emails: [verification[0]?.email, personal[0]?.email].map(lower).filter(Boolean),
    firstName: personal[0]?.first_name ?? verification[0]?.firstname ?? null,
  };
}

function fromPending(p: any): Found {
  return {
    type: "pending_employee",
    registrationId: p.registration_id,
    status: "pending_approval",
    currentStep: "submitted",
    dates: { created_at: p.created_at, submitted_at: p.submission_date ?? p.created_at, approved_at: null, rejected_at: null },
    emails: [lower(p.email)].filter(Boolean),
    firstName: p.firstname ?? null,
  };
}

function fromEmployee(e: any): Found {
  return {
    type: "employee",
    registrationId: e.registration_id ?? null,
    status: "approved",
    currentStep: null,
    dates: { created_at: null, submitted_at: null, approved_at: null, rejected_at: null },
    emails: [lower(e.email)].filter(Boolean),
    firstName: typeof e.name === "string" ? e.name.trim().split(/\s+/)[0] ?? null : null,
  };
}

async function lookupById(id: string): Promise<Found | null> {
  const registration = await registrationById(id);
  if (registration) return fromRegistration(registration);
  const pending = await pendingById(id);
  if (pending) return fromPending(pending);
  const employee = await employeeById(id);
  return employee ? fromEmployee(employee) : null;
}

async function lookupByEmail(email: string): Promise<Found | null> {
  const [byVerification] = await sql`SELECT registration_id FROM "VerificationData" WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  const [byPersonal] = await sql`SELECT registration_id FROM personal_info WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  for (const ref of [byVerification?.registration_id, byPersonal?.registration_id]) {
    if (!ref) continue;
    const [registration] = await sql`SELECT * FROM registrations WHERE id::text = ${String(ref)} OR registration_id = ${String(ref)} LIMIT 1`;
    if (registration) return fromRegistration(registration);
  }
  const [pending] = await sql`SELECT * FROM pending_employees WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  if (pending) return fromPending(pending);
  const [employee] = await sql`SELECT id, registration_id, name, email, status FROM employees WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  return employee ? fromEmployee(employee) : null;
}

async function track(request: NextRequest, rawId: unknown, rawEmail: unknown) {
  const id = typeof rawId === "string" && rawId.trim() ? rawId.trim().slice(0, 64) : null;
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim().slice(0, 255) : null;
  const requireBoth = process.env.TRACK_REQUIRE_EMAIL === "true";

  if (requireBoth ? !id || !email : !id && !email) {
    return withCors(request, { success: false, error: requireBoth ? "IPPIS number and email are required" : "IPPIS number or email is required" }, 400);
  }

  // Slow down anyone trying many numbers or addresses
  const ip = clientIp(request);
  if (peek(`track:miss:${ip}`) >= MISSES_PER_IP) {
    return tooManyRequests(request, Math.ceil(WINDOW_MS / 1000), "Too many lookups. Try again later.");
  }
  const lookups = hit(`track:ip:${ip}`, LOOKUPS_PER_IP, WINDOW_MS);
  if (!lookups.allowed) return tooManyRequests(request, lookups.retryAfter, "Too many lookups. Try again later.");

  const found = id ? await lookupById(id) : await lookupByEmail(email!);
  // With both, the email must belong to the application found by number
  const matched = !!found && !!id && !!email && found.emails.includes(lower(email));
  if (!found || (id && email && !matched)) {
    hit(`track:miss:${ip}`, MISSES_PER_IP, WINDOW_MS);
    return withCors(request, { success: false, error: NOT_FOUND }, 404);
  }

  // The IPPIS number is never given out to someone who only knows an email address
  const registrationId = id ? found.registrationId : null;

  if (found.type === "employee") {
    return withCors(request, {
      success: true,
      type: "employee",
      status: "approved",
      message: "This application has been approved. Sign in to the employee portal to see your record.",
      data: { registration_id: registrationId, status: "approved", ...(matched ? { first_name: found.firstName } : {}) },
      tracked_id: id ?? email,
      normalized_id: id ? normalizeRegistrationId(id) : null,
    });
  }

  return withCors(request, {
    success: true,
    type: found.type,
    status: found.status,
    data: {
      registration: {
        registration_id: registrationId,
        status: found.status,
        current_step: found.currentStep,
        ...found.dates,
      },
      ...(matched ? { first_name: found.firstName } : {}),
    },
    tracked_id: id ?? email,
    normalized_id: id ? normalizeRegistrationId(id) : null,
  });
}

// ?id= (or ?registrationId=) and/or ?email=
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    return await track(request, url.searchParams.get("id") || url.searchParams.get("registrationId"), url.searchParams.get("email"));
  } catch (error) {
    console.error("TRACKING GET ERROR:", error);
    return withCors(request, { success: false, error: "Could not check the application right now" }, 500);
  }
}

// Body: { registrationId?, email? }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { registrationId?: unknown; id?: unknown; email?: unknown };
    return await track(request, body.registrationId ?? body.id, body.email);
  } catch (error) {
    console.error("TRACKING POST ERROR:", error);
    return withCors(request, { success: false, error: "Could not check the application right now" }, 500);
  }
}
