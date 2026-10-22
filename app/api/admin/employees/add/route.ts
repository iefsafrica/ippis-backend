import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";
import {
  canonicalizeRegistrationId,
  normalizeRegistrationId,
} from "@/lib/registration-id";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";

// Create Neon client
const sql = neon(process.env.DATABASE_URL!);

// Helper: check if a table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error);
    return false;
  }
}

import { generateRegistrationId } from "@/lib/register-utils";
import { sendEmployeeRegistrationEmail } from "@/lib/email";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.records.create");
    if (!auth.ok) return auth.response;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return withCors(
        req,
        {
          success: false,
          error: "Invalid JSON body.",
        },
        400
      );
    }

    // --- Core Pending Employee Fields ---
    const surname = body.surname?.trim();
    const firstname = (body.firstname || body.first_name)?.trim();
    const email = body.email?.trim().toLowerCase();
    let department = body.department?.trim();
    const position = body.position?.trim();

    if (!firstname || !surname || !email) {
      return withCors(
        req,
        {
          success: false,
          error: "Missing required core fields: firstname, surname, or email.",
        },
        400
      );
    }

    // --- VerificationData Fields ---
    const nin = body.nin?.trim() || null;
    const middlename = (body.middlename || body.other_names)?.trim() || null;
    const gender = (body.gender || body.sex)?.trim() || null;
    const telephoneno = (body.telephoneno || body.phone_number)?.trim() || null;
    const birthdate = (body.birthdate || body.date_of_birth || body.dateOfBirth)?.trim() || null;
    const state_of_origin = (body.state_of_origin || body.stateOfOrigin)?.trim() || null;
    const residence_address = (body.residence_address || body.address_state_of_residence || body.addressStateOfResidence)?.trim() || null;
    const residence_state = (body.residence_state || body.state_of_residence || body.stateOfResidence)?.trim() || null;
    const residence_lga = (body.residence_lga || body.lga)?.trim() || null;
    const profession = body.profession?.trim() || null;
    const maritalstatus = (body.maritalstatus || body.marital_status || body.maritalStatus)?.trim() || null;

    // --- Extended Personal Info Fields ---
    const title = body.title?.trim() || null;
    const next_of_kin_name = (body.next_of_kin_name || body.nextOfKinName)?.trim() || null;
    const next_of_kin_relationship = (body.next_of_kin_relationship || body.nextOfKinRelationship)?.trim() || null;
    const next_of_kin_phone_number = (body.next_of_kin_phone_number || body.nextOfKinPhoneNumber)?.trim() || null;
    const next_of_kin_address = (body.next_of_kin_address || body.nextOfKinAddress)?.trim() || null;

    // --- Employment Info Fields ---
    const grade_level = (body.grade_level || body.gl)?.trim() || null;
    const step = (body.step || body.steps)?.trim() || null;
    const employment_id_no = body.employment_id_no?.trim() || null;
    const service_no = body.service_no?.trim() || null;
    const file_no = body.file_no?.trim() || null;
    const rank_position = body.rank_position?.trim() || null;
    let organization = body.organization?.trim() || null;

    // The MDA (and optionally department) the new registration belongs to.
    // Someone without rights across all MDAs must choose one inside their scope.
    const sc = recordScope(auth.ctx, "employees.records.create");
    let mdaId: number | null = null;
    let departmentId: number | null = null;
    const rawMda = body.company_id ?? body.mda_id;
    if (rawMda !== undefined && rawMda !== null && rawMda !== "") {
      mdaId = Number(rawMda);
      const mdaRows = Number.isInteger(mdaId) ? await sql`SELECT id, name, status FROM companies WHERE id = ${mdaId}` : [];
      if (!mdaRows[0] || String(mdaRows[0].status ?? "active").toLowerCase() !== "active") {
        return withCors(req, { success: false, error: "company_id must be an active MDA" }, 400);
      }
      organization = mdaRows[0].name;
      if (body.department_id !== undefined && body.department_id !== null && body.department_id !== "") {
        departmentId = Number(body.department_id);
        const deptRows = Number.isInteger(departmentId)
          ? await sql`SELECT id, name FROM departments WHERE id = ${departmentId} AND company_id = ${mdaId}`
          : [];
        if (!deptRows[0]) return withCors(req, { success: false, error: "department_id must be a department of that MDA" }, 400);
        department = deptRows[0].name;
      }
    }
    if (!sc.all) {
      if (mdaId === null) {
        return withCors(req, { success: false, error: "company_id (the MDA) is required" }, 400);
      }
      const reachable = sc.companyIds.includes(mdaId) || (departmentId !== null && sc.departmentIds.includes(departmentId));
      if (!reachable) {
        return withCors(req, { success: false, error: "That MDA or department is outside your organisational scope" }, 403);
      }
    }
    const employment_type = body.employment_type?.trim() || null;
    const probation_period = body.probation_period?.trim() || null;
    const work_location = body.work_location?.trim() || null;
    const date_of_first_appointment = body.date_of_first_appointment?.trim() || null;
    const salary_structure = body.salary_structure?.trim() || null;
    const cadre = body.cadre?.trim() || null;
    const bank_name = (body.bank_name || body.name_of_bank)?.trim() || null;
    const account_number = (body.account_number || body.nuban_account_number)?.trim() || null;
    const pfa_name = body.pfa_name?.trim() || null;
    const rsa_pin = (body.rsa_pin || body.rsapin)?.trim() || null;

    // --- Metadata ---
    const metadata = body.metadata || body.meta_data || null;

    // Ensure pending_employees table exists (basic check)
    if (!(await tableExists("pending_employees"))) {
      return withCors(req, { success: false, error: "The 'pending_employees' table does not exist." }, 404);
    }

    // Check if email already exists in pending_employees, ignoring case
    const pendingEmailExists = await sql`
      SELECT 1
      FROM pending_employees
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (pendingEmailExists.length > 0) {
      return withCors(req, { success: false, error: "This email is already registered as a pending employee." }, 400);
    }

    // Check if email already exists in active employees table, ignoring case
    const activeEmailExists = await sql`
      SELECT 1
      FROM employees
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (activeEmailExists.length > 0) {
      return withCors(req, { success: false, error: "This email is already registered to an active employee." }, 400);
    }

    // Check if NIN already exists
    if (nin) {
      const ninExists = await sql`SELECT 1 FROM "VerificationData" WHERE nin = ${nin} LIMIT 1`;
      if (ninExists.length > 0) {
        return withCors(req, { success: false, error: "This NIN is already registered to another employee." }, 400);
      }
    }

    // Generate registration ID
    const registrationId = await generateRegistrationId();

    // 1. Insert into registrations
    const registrationInserted = await sql`
      INSERT INTO registrations (
        registration_id,
        status,
        current_step,
        submitted_at,
        updated_at
      )
      VALUES (${registrationId}, 'pending_approval', 'submitted', NOW(), NOW())
      RETURNING id, registration_id
    `;
    const regRecordId = registrationInserted[0]!.id;

    // 2. Insert into VerificationData
    await sql`
      INSERT INTO "VerificationData" (
        id, registration_id, nin, firstname, surname, middlename, email, gender, 
        telephoneno, birthdate, state_of_origin, residence_address, residence_state, 
        residence_lga, profession, maritalstatus
      )
      VALUES (
        ${uuidv4()}, ${regRecordId}, ${nin}, ${firstname}, ${surname}, ${middlename}, ${email}, ${gender},
        ${telephoneno}, ${birthdate}, ${state_of_origin}, ${residence_address}, ${residence_state},
        ${residence_lga}, ${profession}, ${maritalstatus}
      )
    `;

    // 3. Insert into personal_info
    await sql`
      INSERT INTO personal_info (
        registration_id, title, surname, first_name, other_names, phone_number, email,
        date_of_birth, sex, marital_status, state_of_origin, lga, state_of_residence,
        address_state_of_residence, next_of_kin_name, next_of_kin_relationship,
        next_of_kin_phone_number, next_of_kin_address
      )
      VALUES (
        ${registrationId}, ${title}, ${surname}, ${firstname}, ${middlename}, ${telephoneno}, ${email},
        ${birthdate}, ${gender}, ${maritalstatus}, ${state_of_origin}, ${residence_lga}, ${residence_state},
        ${residence_address}, ${next_of_kin_name}, ${next_of_kin_relationship},
        ${next_of_kin_phone_number}, ${next_of_kin_address}
      )
    `;

    // 4. Insert into employment_info
    if (grade_level || step || employment_id_no || organization || bank_name || pfa_name) {
      await sql`
        INSERT INTO employment_info (
          registration_id, employment_id_no, service_no, file_no, rank_position, department,
          organization, employment_type, probation_period, work_location, date_of_first_appointment,
          gl, step, salary_structure, cadre, name_of_bank, account_number, pfa_name, rsapin,
          company_id, department_id
        )
        VALUES (
          ${registrationId}, ${employment_id_no}, ${service_no}, ${file_no}, ${rank_position}, ${department},
          ${organization}, ${employment_type}, ${probation_period}, ${work_location}, ${date_of_first_appointment},
          ${grade_level}, ${step}, ${salary_structure}, ${cadre}, ${bank_name}, ${account_number}, ${pfa_name}, ${rsa_pin},
          ${mdaId}, ${departmentId}
        )
      `;
    }

    // 5. Insert into pending_employees
    const inserted = await sql`
      INSERT INTO pending_employees
        (registration_id, firstname, surname, email, department, position, source, metadata, submission_date, created_at, updated_at)
      VALUES
        (${registrationId}, ${firstname}, ${surname}, ${email}, ${department || null}, ${position || null}, 'form', ${metadata ? JSON.stringify(metadata) : null}, NOW(), NOW(), NOW())
      RETURNING *
    `;
    const employee = inserted[0];

    // 5. Send Email (HTML notification with Registration ID and Onboarding link)
    const baseUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.APP_URL || "https://ippis-frontend.vercel.app";
    const registrationLink = `${baseUrl}/register?email=${encodeURIComponent(email)}`;

    await sendEmployeeRegistrationEmail({
      to: email,
      fullName: `${firstname} ${surname}`.trim(),
      registrationId,
      department: department || undefined,
      position: position || undefined,
      onboardingUrl: registrationLink,
    }).catch((emailError) => {
      console.error("Failed to send employee registration email:", emailError);
    });

    await runAudited(req, auth.ctx, {
      action: "employees.record.created",
      targetType: "employee",
      targetId: registrationId,
      details: {},
    }, []);

    return withCors(req, {
      success: true,
      message: "Employee added successfully across all records.",
      data: employee,
    });
  } catch (error) {
    console.error("❌ Error adding new employee:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to add new employee.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
