import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import {
  buildRegistrationIdVariants,
  resolveRegistrationIdInput,
} from "../../../../../../lib/registration-id";

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
    const body = (await req.json()) as PersonalInfoBody;
    const registration_id = resolveRegistrationIdInput(
      req.headers.get("x-registration-id"),
      (body as { registration_id?: string }).registration_id
    );

    if (!registration_id) {
      return withCors(req, {
        success: false,
        message: "Missing registration ID in headers"
      }, 400);
    }

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
    let existing: Array<{ registration_id: string }> = [];
    for (const candidate of buildRegistrationIdVariants(registration_id)) {
      existing = (await sql`
        SELECT registration_id
        FROM registrations
        WHERE registration_id = ${candidate}
        LIMIT 1
      `) as Array<{ registration_id: string }>;
      if (existing.length > 0) break;
    }

    if (existing.length === 0) {
      return withCors(req, {
        success: false,
        message: "Invalid registration ID"
      }, 404);
    }

    const resolvedRegistrationId = existing[0]!.registration_id as string;

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
        ${resolvedRegistrationId},
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
      ON CONFLICT (registration_id) DO UPDATE SET
        title = EXCLUDED.title,
        surname = EXCLUDED.surname,
        first_name = EXCLUDED.first_name,
        other_names = EXCLUDED.other_names,
        phone_number = EXCLUDED.phone_number,
        email = EXCLUDED.email,
        date_of_birth = EXCLUDED.date_of_birth,
        sex = EXCLUDED.sex,
        marital_status = EXCLUDED.marital_status,
        state_of_origin = EXCLUDED.state_of_origin,
        lga = EXCLUDED.lga,
        state_of_residence = EXCLUDED.state_of_residence,
        address_state_of_residence = EXCLUDED.address_state_of_residence,
        next_of_kin_name = EXCLUDED.next_of_kin_name,
        next_of_kin_relationship = EXCLUDED.next_of_kin_relationship,
        next_of_kin_phone_number = EXCLUDED.next_of_kin_phone_number,
        next_of_kin_address = EXCLUDED.next_of_kin_address
    `;

    /* -------------------------
       UPDATE STEP
    ------------------------- */
    await sql`
      UPDATE registrations
      SET current_step = 'employment'
      WHERE registration_id = ${resolvedRegistrationId}
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
