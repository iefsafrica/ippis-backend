import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   TYPES
------------------------- */
interface PersonalInfoBody {
  title?: string;
  surname: string;
  first_name: string;
  other_names?: string;
  phone_number: string;
  email: string;
  date_of_birth: string;
  sex: string;
  marital_status: string;
  state_of_origin: string;
  lga: string;
  state_of_residence: string;
  address_state_of_residence: string;
  next_of_kin_name: string;
  next_of_kin_relationship: string;
  next_of_kin_phone_number: string;
  next_of_kin_address: string;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   POST: PERSONAL INFO
------------------------- */
export async function POST(req: NextRequest) {
  try {
    /* -------------------------
       GET REGISTRATION ID FROM HEADER
    ------------------------- */
    const registration_id = req.headers.get("x-registration-id");

    if (!registration_id) {
      return withCors(req, {
        success: false,
        message: "Missing registration ID in headers"
      }, 400);
    }

    /* -------------------------
       PARSE BODY
    ------------------------- */
    const body = (await req.json()) as PersonalInfoBody;

    const {
      title,
      surname,
      first_name,
      other_names,
      phone_number,
      email,
      date_of_birth,
      sex,
      marital_status,
      state_of_origin,
      lga,
      state_of_residence,
      address_state_of_residence,
      next_of_kin_name,
      next_of_kin_relationship,
      next_of_kin_phone_number,
      next_of_kin_address
    } = body;

    /* -------------------------
       VALIDATION
    ------------------------- */
    if (
      !surname ||
      !first_name ||
      !phone_number ||
      !email ||
      !date_of_birth ||
      !sex ||
      !marital_status ||
      !state_of_origin ||
      !lga ||
      !state_of_residence ||
      !address_state_of_residence ||
      !next_of_kin_name ||
      !next_of_kin_relationship ||
      !next_of_kin_phone_number ||
      !next_of_kin_address
    ) {
      return withCors(req, {
        success: false,
        message: "All required fields must be provided"
      }, 400);
    }

    /* -------------------------
       CHECK REGISTRATION EXISTS
    ------------------------- */
    const existing = await sql`
      SELECT registration_id
      FROM registrations
      WHERE registration_id = ${registration_id}
    `;

    if (existing.length === 0) {
      return withCors(req, {
        success: false,
        message: "Invalid registration ID"
      }, 404);
    }

    /* -------------------------
       INSERT PERSONAL INFO
    ------------------------- */
    await sql`
      INSERT INTO personal_info (
        registration_id,
        title,
        surname,
        first_name,
        other_names,
        phone_number,
        email,
        date_of_birth,
        sex,
        marital_status,
        state_of_origin,
        lga,
        state_of_residence,
        address_state_of_residence,
        next_of_kin_name,
        next_of_kin_relationship,
        next_of_kin_phone_number,
        next_of_kin_address
      )
      VALUES (
        ${registration_id},
        ${title ?? null},
        ${surname},
        ${first_name},
        ${other_names ?? null},
        ${phone_number},
        ${email},
        ${date_of_birth},
        ${sex},
        ${marital_status},
        ${state_of_origin},
        ${lga},
        ${state_of_residence},
        ${address_state_of_residence},
        ${next_of_kin_name},
        ${next_of_kin_relationship},
        ${next_of_kin_phone_number},
        ${next_of_kin_address}
      )
    `;

    /* -------------------------
       UPDATE STEP
    ------------------------- */
    await sql`
      UPDATE registrations
      SET current_step = 'employment'
      WHERE registration_id = ${registration_id}
    `;

    /* -------------------------
       SUCCESS RESPONSE
    ------------------------- */
    return withCors(req, {
      success: true,
      message: "Personal information saved successfully",
      next_step: "employment"
    });

  } catch (error: any) {
    console.error("PERSONAL INFO ERROR:", error);

    return withCors(req, {
      success: false,
      message: "Failed to save personal information",
      error: error.message
    }, 500);
  }
}