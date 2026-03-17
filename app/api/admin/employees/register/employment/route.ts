import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   TYPES
------------------------- */
interface EmploymentInfoBody {
  employment_id_no: string;
  service_no: string;
  file_no: string;
  rank_position: string;
  department: string;
  organization: string;
  employment_type: string;
  probation_period: string;
  work_location: string;
  date_of_first_appointment: string;
  grade_level: string;
  step: string;
  salary_structure: string;
  cadre: string;
  bank_name: string;
  nuban_account_number: string;
  pfa_name: string;
  rsa_pin: string;
}

/* -------------------------
   OPTIONS
------------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   POST: EMPLOYEE INFO
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
    const body = (await req.json()) as EmploymentInfoBody;

    const {
      employment_id_no,
      service_no,
      file_no,
      rank_position,
      department,
      organization,
      employment_type,
      probation_period,
      work_location,
      date_of_first_appointment,
      grade_level,
      step,
      salary_structure,
      cadre,
      bank_name,
      nuban_account_number,
      pfa_name,
      rsa_pin
    } = body;

    /* -------------------------
       VALIDATION
    ------------------------- */
    if (
      !employment_id_no ||
      !service_no ||
      !file_no ||
      !rank_position ||
      !department ||
      !organization ||
      !employment_type ||
      !probation_period ||
      !work_location ||
      !date_of_first_appointment ||
      !grade_level ||
      !step ||
      !salary_structure ||
      !cadre ||
      !bank_name ||
      !nuban_account_number ||
      !pfa_name ||
      !rsa_pin
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
       INSERT EMPLOYEE INFO
    ------------------------- */
    await sql`
      INSERT INTO employee_info (
        registration_id,
        employment_id_no,
        service_no,
        file_no,
        rank_position,
        department,
        organization,
        employment_type,
        probation_period,
        work_location,
        date_of_first_appointment,
        grade_level,
        step,
        salary_structure,
        cadre,
        bank_name,
        nuban_account_number,
        pfa_name,
        rsa_pin
      )
      VALUES (
        ${registration_id},
        ${employment_id_no},
        ${service_no},
        ${file_no},
        ${rank_position},
        ${department},
        ${organization},
        ${employment_type},
        ${probation_period},
        ${work_location},
        ${date_of_first_appointment},
        ${grade_level},
        ${step},
        ${salary_structure},
        ${cadre},
        ${bank_name},
        ${nuban_account_number},
        ${pfa_name},
        ${rsa_pin}
      )
    `;

    /* -------------------------
       UPDATE STEP
    ------------------------- */
    await sql`
      UPDATE registrations
      SET current_step = 'documents'
      WHERE registration_id = ${registration_id}
    `;

    /* -------------------------
       SUCCESS RESPONSE
    ------------------------- */
    return withCors(req, {
      success: true,
      message: "Employee information saved successfully",
      next_step: "documents"
    });

  } catch (error: any) {
    console.error("EMPLOYEE INFO ERROR:", error);

    return withCors(req, {
      success: false,
      message: "Failed to save employee information",
      error: error.message
    }, 500);
  }
}