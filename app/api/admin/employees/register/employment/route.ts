import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import {
  findRegistrationIdInDb,
  resolveRegistrationIdInput,
} from "@/lib/registration-id";

import { isApprovedApplication, APPROVED_LOCKED } from "@/lib/registration-lock";

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
  // Optional: the MDA and department picked from the official lists
  company_id?: number | string | null;
  mda_id?: number | string | null;
  department_id?: number | string | null;
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
  registration_id?: string;
  gl?: string;
  account_number?: string;
  name_of_bank?: string;
  rsapin?: string;
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
    const body = (await req.json()) as EmploymentInfoBody;
    const registration_id = resolveRegistrationIdInput(
      req.headers.get("x-registration-id"),
      body.registration_id
    );

    if (!registration_id) {
      return withCors(req, {
        success: false,
        message: "Missing registration ID in headers"
      }, 400);
    }

    let {
      department,
      organization,
    } = body;
    const {
      employment_id_no,
      service_no,
      file_no,
      rank_position,
      employment_type,
      probation_period,
      work_location,
      date_of_first_appointment,
      step,
      salary_structure,
      cadre,
      pfa_name,
    } = body;

    const gradeLevel = body.grade_level ?? body.gl;
    const bankName = body.bank_name ?? body.name_of_bank;
    const accountNumber = body.nuban_account_number ?? body.account_number;
    const rsaPin = body.rsa_pin ?? body.rsapin;

    /* -------------------------
       MDA FROM THE OFFICIAL LIST
       The form may send the MDA (company_id or mda_id) and department
       (department_id) picked from the official lists. They are checked, and
       the official names fill in organization/department, so the employee can
       be linked to their MDA on approval.
    ------------------------- */
    const rawMda = body.company_id ?? body.mda_id;
    let chosenMdaId: number | null = null;
    let chosenDepartmentId: number | null = null;
    if (rawMda !== undefined && rawMda !== null && rawMda !== "") {
      chosenMdaId = Number(rawMda);
      const mdaRows = Number.isInteger(chosenMdaId)
        ? await sql`SELECT id, name, status FROM companies WHERE id = ${chosenMdaId}`
        : [];
      const mda = mdaRows[0];
      if (!mda || String(mda.status ?? "active").toLowerCase() !== "active") {
        return withCors(req, { success: false, message: "Choose an MDA from the list" }, 400);
      }
      organization = mda.name;

      const rawDept = body.department_id;
      if (rawDept !== undefined && rawDept !== null && rawDept !== "") {
        chosenDepartmentId = Number(rawDept);
        const deptRows = Number.isInteger(chosenDepartmentId)
          ? await sql`SELECT id, name FROM departments WHERE id = ${chosenDepartmentId} AND company_id = ${chosenMdaId}`
          : [];
        if (!deptRows[0]) {
          return withCors(req, { success: false, message: `Choose a department of ${mda.name} from the list` }, 400);
        }
        department = deptRows[0].name;
      }
    } else if (body.department_id !== undefined && body.department_id !== null && body.department_id !== "") {
      return withCors(req, { success: false, message: "Choose the MDA before the department" }, 400);
    }

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
      !gradeLevel ||
      !step ||
      !salary_structure ||
      !cadre ||
      !bankName ||
      !accountNumber ||
      !pfa_name ||
      !rsaPin
    ) {
      return withCors(req, {
        success: false,
        message: "All required fields must be provided"
      }, 400);
    }

    /* -------------------------
       CHECK REGISTRATION EXISTS
    ------------------------- */
    const resolvedRegistrationId = await findRegistrationIdInDb(sql, registration_id);

    if (!resolvedRegistrationId) {
      return withCors(req, {
        success: false,
        message: "Invalid registration ID"
      }, 404);
    }
    if (await isApprovedApplication(resolvedRegistrationId)) {
      return withCors(req, { success: false, message: APPROVED_LOCKED }, 409);
    }

    /* -------------------------
       INSERT EMPLOYEE INFO
    ------------------------- */
    await sql`
      INSERT INTO employment_info (
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
        gl,
        step,
        salary_structure,
        cadre,
        name_of_bank,
        account_number,
        pfa_name,
        rsapin
      )
      VALUES (
        ${resolvedRegistrationId},
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
        ${gradeLevel},
        ${step},
        ${salary_structure},
        ${cadre},
        ${bankName},
        ${accountNumber},
        ${pfa_name},
        ${rsaPin}
      )
      ON CONFLICT (registration_id) DO UPDATE SET
        employment_id_no = EXCLUDED.employment_id_no,
        service_no = EXCLUDED.service_no,
        file_no = EXCLUDED.file_no,
        rank_position = EXCLUDED.rank_position,
        department = EXCLUDED.department,
        organization = EXCLUDED.organization,
        employment_type = EXCLUDED.employment_type,
        probation_period = EXCLUDED.probation_period,
        work_location = EXCLUDED.work_location,
        date_of_first_appointment = EXCLUDED.date_of_first_appointment,
        gl = EXCLUDED.gl,
        step = EXCLUDED.step,
        salary_structure = EXCLUDED.salary_structure,
        cadre = EXCLUDED.cadre,
        name_of_bank = EXCLUDED.name_of_bank,
        account_number = EXCLUDED.account_number,
        pfa_name = EXCLUDED.pfa_name,
        rsapin = EXCLUDED.rsapin
    `;

    // Kept apart from the insert above so registration still works on a
    // database where employee-mda-migration.sql has not been run yet
    if (chosenMdaId !== null) {
      try {
        await sql`
          UPDATE employment_info
          SET company_id = ${chosenMdaId}, department_id = ${chosenDepartmentId}
          WHERE registration_id = ${resolvedRegistrationId}
        `;
      } catch (linkError: any) {
        if (linkError?.code !== "42703") throw linkError;
        console.warn("employment_info has no company_id column yet; run database/employee-mda-migration.sql");
      }
    }

    /* -------------------------
       UPDATE STEP
    ------------------------- */
    await sql`
      UPDATE registrations
      SET current_step = 'documents'
      WHERE registration_id = ${resolvedRegistrationId}
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
      message: "Failed to save employee information"
    }, 500);
  }
}
