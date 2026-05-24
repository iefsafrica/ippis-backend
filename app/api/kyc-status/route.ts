import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";
import { generateRegistrationId } from "@/lib/register-utils";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

type RegistrationRow = {
  id: number;
  registration_id: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userRef = searchParams.get("userRef");
  const slug = searchParams.get("slug");

  if (!userRef || !slug) {
    return withCors(req, {
      success: false,
      message: "userRef and slug are required"
    }, 400);
  }

  const apiKey = process.env.NETAPPS_SECRET_KEY;
  if (!apiKey) {
    return withCors(req, {
      success: false,
      message: "Server configuration error: Missing API key"
    }, 500);
  }

  try {
    const response = await fetch(`https://kyc-api.netapps.ng/api/v1/user/kyc?userRef=${userRef}&slug=${slug}`, {
      method: "GET",
      headers: {
        "x-secret-key": apiKey,
        "Content-Type": "application/json"
      }
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      return withCors(req, {
        success: false,
        message: data.message || "Failed to fetch KYC status",
        error: data
      }, response.status);
    }

    // Successfully fetched status. Now let's try to extract and persist verified NIN & KYC details!
    const { nin, kycData } = extractNinAndKycData(data);
    let resolvedId: string | null = null;
    let resolvedRegistrationId: string | null = null;

    if (nin) {
      // Check if the extracted NIN is correct/valid (must be exactly 11 digits)
      const NIN_REGEX = /^\d{11}$/;
      if (!NIN_REGEX.test(nin)) {
        return withCors(req, {
          success: false,
          message: "Invalid NIN format returned from verification provider.",
          error: "INVALID_NIN_FORMAT"
        }, 400);
      }

      // 1. Search for an existing registration by NIN
      const existingByNin = await sql`
        SELECT id, registration_id
        FROM registrations
        WHERE nin = ${nin}
        LIMIT 1
      ` as RegistrationRow[];

      if (existingByNin.length > 0) {
        resolvedId = String(existingByNin[0]!.id);
        resolvedRegistrationId = existingByNin[0]!.registration_id;
      } else {
        // 2. Search for an existing registration by userRef (in case it is a registration_id or pk id)
        const existingByRef = await sql`
          SELECT id, registration_id
          FROM registrations
          WHERE registration_id = ${userRef} OR id::text = ${userRef}
          LIMIT 1
        ` as RegistrationRow[];

        if (existingByRef.length > 0) {
          resolvedId = String(existingByRef[0]!.id);
          resolvedRegistrationId = existingByRef[0]!.registration_id;
          // Update the registration with the verified NIN
          await sql`
            UPDATE registrations
            SET nin = ${nin}, updated_at = NOW()
            WHERE id = ${existingByRef[0]!.id}
          `;
        } else {
          // 3. Create a brand new registration since none exists by NIN or userRef
          const normalizedRef = userRef.trim().toUpperCase();
          const isValidIdStructure = normalizedRef.startsWith("IPPIS-");

          const regIdToInsert = isValidIdStructure ? normalizedRef : await generateRegistrationId();

          const inserted = await sql`
            INSERT INTO registrations (
              registration_id,
              nin,
              status,
              current_step,
              updated_at
            )
            VALUES (
              ${regIdToInsert},
              ${nin},
              'pending',
              'personal',
              NOW()
            )
            RETURNING id, registration_id
          ` as RegistrationRow[];

          resolvedId = String(inserted[0]!.id);
          resolvedRegistrationId = inserted[0]!.registration_id;
        }
      }

      // Check if this NIN is already verified in VerificationData under a different registration ID
      const duplicateKyc = await sql`
        SELECT registration_id FROM "VerificationData"
        WHERE nin = ${nin} AND registration_id != ${resolvedId}
        LIMIT 1
      ` as { registration_id: string }[];

      if (duplicateKyc.length > 0) {
        return withCors(req, {
          success: false,
          message: "This NIN is already verified under a different account.",
          error: "DUPLICATE_NIN"
        }, 400);
      }

      // 4. Save/upsert the verification data
      if (kycData) {
        await upsertVerificationData(resolvedId, nin, kycData);
      }
    }

    return withCors(req, {
      success: true,
      registration_id: resolvedRegistrationId,
      data
    }, 200);

  } catch (error: any) {
    console.error("KYC Status Error:", error);
    return withCors(req, {
      success: false,
      message: "Failed to fetch KYC status",
      error: error.message
    }, 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function extractNinAndKycData(data: any): { nin: string | null; kycData: any | null } {
  if (!data || typeof data !== "object") {
    return { nin: null, kycData: null };
  }

  const rootObj = data.data || data;

  if (Array.isArray(rootObj?.requirements)) {
    const ninReq = rootObj.requirements.find(
      (r: any) =>
        r?.type?.toLowerCase() === "nin" ||
        r?.kycType?.toLowerCase() === "nin" ||
        r?.type?.toLowerCase() === "nin_verification"
    );
    if (ninReq) {
      const ninValue = ninReq.value || ninReq.result?.nin || null;
      const resultObj = ninReq.result || ninReq.data || ninReq;
      if (ninValue || resultObj) {
        return {
          nin: ninValue ? String(ninValue).trim() : null,
          kycData: resultObj
        };
      }
    }
  }

  const ninValue = rootObj?.nin || rootObj?.nin_number || rootObj?.value || null;
  const kycData = rootObj?.result || rootObj?.data || rootObj;

  return {
    nin: ninValue ? String(ninValue).trim() : null,
    kycData: kycData || null
  };
}

async function upsertVerificationData(
  registrationId: string,
  nin: string,
  data: any
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

function getFirstString(data: any, keys: string[]) {
  if (!data || typeof data !== "object") return null;
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
