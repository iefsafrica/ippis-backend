import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";
import { withCors, handleOptions } from "@/lib/cors";
import { verifyNIN } from "@/lib/verification-service";
import { generateRegistrationId } from "@/lib/register-utils";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);
const NIN_REGEX = /^\d{11}$/;

type VerifyNinBody = {
  nin?: string;
};

type RegistrationRow = {
  id: number;
  registration_id: string;
};

type NetappsNinData = Record<string, unknown>;

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  let body: VerifyNinBody;

  try {
    body = (await req.json()) as VerifyNinBody;
  } catch {
    return withCors(req, { success: false, error: "Invalid JSON body" }, 400);
  }

  const nin = body.nin?.trim();

  if (!nin) {
    return withCors(req, { success: false, error: "nin is required" }, 400);
  }

  if (!NIN_REGEX.test(nin)) {
    return withCors(req, {
      success: false,
      error: "Invalid NIN format. NIN must be exactly 11 digits.",
    }, 400);
  }

  const verification = await verifyNIN(nin);
  const registration = await findOrCreateRegistration(nin, verification.verified);

  if (verification.verified && verification.data) {
    const registrationPk = String(registration.id);

    // Check if this NIN is already verified in VerificationData under a different registration_id
    const duplicateKyc = await sql`
      SELECT registration_id FROM "VerificationData"
      WHERE nin = ${nin} AND registration_id != ${registrationPk}
      LIMIT 1
    ` as { registration_id: string }[];

    if (duplicateKyc.length > 0) {
      return withCors(req, {
        success: false,
        error: "This NIN is already verified under a different account."
      }, 400);
    }

    await upsertVerificationData(registrationPk, nin, verification.data);
  }

  return withCors(req, {
    success: true,
    verified: verification.verified,
    registration_id: registration.registration_id,
    message: verification.verified
      ? verification.message || "NIN verified successfully"
      : verification.message || "NIN not verified. Continue manually.",
    data: verification.verified ? verification.data : null,
  }, 200);
}

async function findOrCreateRegistration(
  nin: string,
  shouldStoreNin: boolean
): Promise<RegistrationRow> {
  const existing = await sql`
    SELECT id, registration_id
    FROM registrations
    WHERE nin = ${nin}
    LIMIT 1
  ` as RegistrationRow[];

  if (existing.length > 0) {
    return existing[0]!;
  }

  const registrationId = await generateRegistrationId();
  const storedNin = shouldStoreNin ? nin : null;

  const inserted = await sql`
    INSERT INTO registrations (
      registration_id,
      nin,
      status,
      current_step,
      updated_at
    )
    VALUES (
      ${registrationId},
      ${storedNin},
      'pending',
      'personal',
      NOW()
    )
    RETURNING id, registration_id
  ` as RegistrationRow[];

  return inserted[0]!;
}

async function upsertVerificationData(
  registrationId: string,
  nin: string,
  data: NetappsNinData
) {
  const firstname = getFirstString(data, ["firstname", "first_name", "firstName"]);
  const surname = getFirstString(data, ["surname", "last_name", "lastName"]);
  const middlename = getFirstString(data, ["middlename", "middle_name", "middleName"]);
  const gender = getFirstString(data, ["gender", "sex"]);
  const telephoneno = getFirstString(data, ["telephoneno", "phone", "phone_number"]);
  const birthdate = getFirstString(data, ["birthdate", "date_of_birth", "dateOfBirth"]);
  const stateOfOrigin = getFirstString(data, ["state_of_origin", "self_origin_state", "birthstate"]);
  const residenceAddress = getFirstString(data, ["residence_address", "residence_AdressLine1", "residence_address_line1"]);
  const residenceState = getFirstString(data, ["residence_state", "self_origin_state"]);
  const residenceLga = getFirstString(data, ["residence_lga", "lga_origin", "self_origin_lga"]);
  const profession = getFirstString(data, ["profession"]);
  const maritalstatus = getFirstString(data, ["maritalstatus", "marital_status"]);

  await sql`
    INSERT INTO "VerificationData" (
      id,
      registration_id,
      nin,
      firstname,
      surname,
      middlename,
      gender,
      telephoneno,
      birthdate,
      state_of_origin,
      residence_address,
      residence_state,
      residence_lga,
      profession,
      maritalstatus
    )
    VALUES (
      ${uuidv4()},
      ${registrationId},
      ${nin},
      ${firstname},
      ${surname},
      ${middlename},
      ${gender},
      ${telephoneno},
      ${toDateOrNull(birthdate)},
      ${stateOfOrigin},
      ${residenceAddress},
      ${residenceState},
      ${residenceLga},
      ${profession},
      ${maritalstatus}
    )
    ON CONFLICT (registration_id) DO UPDATE SET
      nin = EXCLUDED.nin,
      firstname = COALESCE(EXCLUDED.firstname, "VerificationData".firstname),
      surname = COALESCE(EXCLUDED.surname, "VerificationData".surname),
      middlename = COALESCE(EXCLUDED.middlename, "VerificationData".middlename),
      gender = COALESCE(EXCLUDED.gender, "VerificationData".gender),
      telephoneno = COALESCE(EXCLUDED.telephoneno, "VerificationData".telephoneno),
      birthdate = COALESCE(EXCLUDED.birthdate, "VerificationData".birthdate),
      state_of_origin = COALESCE(EXCLUDED.state_of_origin, "VerificationData".state_of_origin),
      residence_address = COALESCE(EXCLUDED.residence_address, "VerificationData".residence_address),
      residence_state = COALESCE(EXCLUDED.residence_state, "VerificationData".residence_state),
      residence_lga = COALESCE(EXCLUDED.residence_lga, "VerificationData".residence_lga),
      profession = COALESCE(EXCLUDED.profession, "VerificationData".profession),
      maritalstatus = COALESCE(EXCLUDED.maritalstatus, "VerificationData".maritalstatus),
      "updatedAt" = NOW()
  `;
}

function getFirstString(data: NetappsNinData, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function toDateOrNull(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}
