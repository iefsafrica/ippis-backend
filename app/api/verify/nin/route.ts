import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   Generate Registration ID
------------------------- */
async function generateRegistrationId(): Promise<string> {
  let nextIdNum = 1;
  let newId = "";

  while (true) {
    newId = `IPPIS-${String(nextIdNum).padStart(4, "0")}`;
    const existing = await sql`
      SELECT id FROM registrations WHERE registration_id = ${newId}
    `;
    if (existing.length === 0) break;
    nextIdNum++;
  }

  return newId;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

type NetAppsWhiteLabelResponse = {
  error: boolean;
  message: string;
  data?: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender?: string;
    phone?: string;
  };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { nin?: string };

    if (!body.nin) {
      return withCors(req, {
        success: false,
        error: "nin is required",
      }, 400);
    }

    /* =========================
       VERIFY NIN
    ========================= */
    const response = await fetch(
      "https://kyc-api.netapps.ng/api/v1/whitelabel/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret-key": process.env.NETAPPS_SECRET_KEY as string,
        },
        body: JSON.stringify({
          kycType: "nin",
          nin: body.nin,
        }),
      }
    );

    const data = (await response.json()) as NetAppsWhiteLabelResponse;

    const isVerified = response.ok && !data.error;

    /* =========================
       CREATE REGISTRATION ALWAYS
    ========================= */
    const registrationId = await generateRegistrationId();

    await sql`
      INSERT INTO registrations (
        registration_id,
        nin,
        status,
        current_step
      )
      VALUES (
        ${registrationId},
        ${body.nin},
        'pending',
        'personal'
      )
    `;

    /* =========================
       RESPONSE
    ========================= */
    return withCors(req, {
      success: true,
      verified: isVerified,
      registration_id: registrationId,
      message: isVerified
        ? "NIN verified successfully"
        : "NIN not verified. Continue manually.",
      data: isVerified ? data.data : null
    });

  } catch (error) {
    console.error("Verification Error:", error);

    /* =========================
       STILL CREATE REGISTRATION
    ========================= */
    const registrationId = await generateRegistrationId();

    await sql`
      INSERT INTO registrations (
        registration_id,
        status,
        current_step
      )
      VALUES (
        ${registrationId},
        'pending',
        'personal'
      )
    `;

    return withCors(req, {
      success: true,
      verified: false,
      registration_id: registrationId,
      message:
        "Verification failed. Continue manually.",
    });
  }
}