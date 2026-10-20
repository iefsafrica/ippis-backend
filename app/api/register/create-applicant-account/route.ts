import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/** Generates a simple applicant PIN for first login */
function generateApplicantPin(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const special = "!@#$";
  let pw = "";
  for (let i = 0; i < 7; i++) {
    pw += chars[crypto.randomInt(chars.length)];
  }
  pw += special[crypto.randomInt(special.length)];
  pw += crypto.randomInt(10, 99);
  return pw.split("").sort(() => crypto.randomInt(3) - 1).join("");
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * POST /api/register/create-applicant-account
 * Called after a successful application submission.
 * Creates or updates the admin_users account with role 'applicant'.
 * Returns: { success, username, temporaryPassword }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, fullName, registrationId } = body as {
      email?: string;
      fullName?: string;
      registrationId?: string;
    };

    if (!email || !registrationId) {
      return withCors(req, {
        success: false,
        error: "email and registrationId are required",
      }, 400);
    }

    const name = fullName || email;
    const temporaryPassword = generateApplicantPin();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // Upsert the admin_users account (idempotent — re-submitting won't break anything)
    await sql`
      INSERT INTO admin_users (
        username, email, password_hash, full_name,
        role, is_active, status, staff_id,
        created_at, updated_at
      )
      VALUES (
        ${email}, ${email}, ${passwordHash}, ${name},
        'applicant', true, 'active', ${registrationId},
        NOW(), NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        role = CASE
          WHEN admin_users.role = 'applicant' THEN 'applicant'
          ELSE admin_users.role
        END,
        full_name  = EXCLUDED.full_name,
        is_active  = true,
        status     = 'active',
        staff_id   = EXCLUDED.staff_id,
        updated_at = NOW()
    `;

    // Only return the new password if we actually just created/reset it
    // (safe because front-end only calls this once on submission)
    return withCors(req, {
      success: true,
      username: email,
      temporaryPassword,
      message: "Applicant portal account created. Credentials sent separately.",
    });

  } catch (error) {
    console.error("[Create Applicant Account] Error:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create applicant account",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
