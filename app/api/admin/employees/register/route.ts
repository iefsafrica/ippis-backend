import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import {
  buildRegistrationIdVariants,
  resolveRegistrationIdInput,
} from "../../../../../lib/registration-id";
import { generateRegistrationId } from "../../../../../lib/register-utils";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

interface RegistrationBody {
  registration_id?: string;
  nin?: string;
  firstname: string;
  surname: string;
  middlename?: string;
  email: string;
  gender?: string;
  telephoneno?: string;
  birthdate?: string;
  state_of_origin?: string;
  residence_address?: string;
  residence_state?: string;
  residence_lga?: string;
  profession?: string;
  maritalstatus?: string;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

async function findRegistrationByAnyFormat(input: string) {
  for (const candidate of buildRegistrationIdVariants(input)) {
    const rows = await sql`
      SELECT id, registration_id, status, current_step
      FROM registrations
      WHERE registration_id = ${candidate}
      LIMIT 1
    `;

    if (rows.length > 0) {
      return rows[0] as {
        id: number;
        registration_id: string;
        status: string;
        current_step: string;
      };
    }
  }

  return null;
}

async function upsertVerificationData(input: {
  registrationId: number;
  body: RegistrationBody;
}) {
  const { registrationId, body } = input;

  await sql`
    INSERT INTO "VerificationData" (
      id,
      registration_id,
      nin,
      firstname,
      surname,
      middlename,
      email,
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
      ${body.nin ?? null},
      ${body.firstname},
      ${body.surname},
      ${body.middlename ?? null},
      ${body.email},
      ${body.gender ?? null},
      ${body.telephoneno ?? null},
      ${body.birthdate ?? null},
      ${body.state_of_origin ?? null},
      ${body.residence_address ?? null},
      ${body.residence_state ?? null},
      ${body.residence_lga ?? null},
      ${body.profession ?? null},
      ${body.maritalstatus ?? null}
    )
    ON CONFLICT (registration_id) DO UPDATE SET
      nin = COALESCE(EXCLUDED.nin, "VerificationData".nin),
      firstname = EXCLUDED.firstname,
      surname = EXCLUDED.surname,
      middlename = EXCLUDED.middlename,
      email = EXCLUDED.email,
      gender = EXCLUDED.gender,
      telephoneno = EXCLUDED.telephoneno,
      birthdate = EXCLUDED.birthdate,
      state_of_origin = EXCLUDED.state_of_origin,
      residence_address = EXCLUDED.residence_address,
      residence_state = EXCLUDED.residence_state,
      residence_lga = EXCLUDED.residence_lga,
      profession = EXCLUDED.profession,
      maritalstatus = EXCLUDED.maritalstatus
  `;
}

async function upsertPendingEmployee(input: {
  registrationId: string;
  body: RegistrationBody;
}) {
  const { registrationId, body } = input;

  await sql`
    INSERT INTO pending_employees (
      registration_id,
      email,
      firstname,
      surname,
      department,
      position,
      status,
      source,
      submission_date,
      created_at,
      updated_at
    )
    VALUES (
      ${registrationId},
      ${body.email},
      ${body.firstname},
      ${body.surname},
      ${null},
      ${null},
      'pending_approval',
      'onboarding',
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (registration_id) DO UPDATE SET
      email = EXCLUDED.email,
      firstname = EXCLUDED.firstname,
      surname = EXCLUDED.surname,
      department = COALESCE(EXCLUDED.department, pending_employees.department),
      position = COALESCE(EXCLUDED.position, pending_employees.position),
      status = 'pending_approval',
      source = EXCLUDED.source,
      updated_at = NOW()
  `;
}

async function updateRegistrationStatus(
  registrationId: string,
  status: string,
  currentStep: string
) {
  await sql`
    UPDATE registrations
    SET
      status = ${status},
      current_step = ${currentStep},
      submitted_at = NOW(),
      updated_at = NOW()
    WHERE registration_id = ${registrationId}
  `;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RegistrationBody;

    const {
      nin,
      firstname,
      surname,
      middlename,
      email,
      gender,
      telephoneno,
      birthdate,
      state_of_origin,
      residence_address,
      residence_state,
      residence_lga,
      profession,
      maritalstatus,
    } = body;

    if (!firstname || !surname || !email) {
      return withCors(
        req,
        { success: false, message: "firstname, surname and email are required" },
        400
      );
    }

    const incomingId = resolveRegistrationIdInput(
      req.headers.get("x-registration-id"),
      body.registration_id
    );

    const existingRegistration = incomingId
      ? await findRegistrationByAnyFormat(incomingId)
      : null;

    const canonicalRegistrationId = existingRegistration
      ? existingRegistration.registration_id
      : incomingId || (await generateRegistrationId());

    let registrationRow = existingRegistration;

    if (!registrationRow) {
      const inserted = await sql`
        INSERT INTO registrations (
          registration_id,
          status,
          current_step,
          submitted_at,
          updated_at
        )
        VALUES (${canonicalRegistrationId}, 'pending_approval', 'submitted', NOW(), NOW())
        RETURNING id, registration_id, status, current_step
      `;
      registrationRow = inserted[0] as {
        id: number;
        registration_id: string;
        status: string;
        current_step: string;
      };
    } else {
      await updateRegistrationStatus(
        registrationRow.registration_id,
        "pending_approval",
        "submitted"
      );
    }

    if (!registrationRow?.id) {
      throw new Error("Failed to create or resolve registration");
    }

    await upsertVerificationData({
      registrationId: registrationRow.id,
      body,
    });

    await upsertPendingEmployee({
      registrationId: registrationRow.registration_id,
      body,
    });

    const message = `Dear ${firstname},

Your employee registration has been received successfully.

Your Employee Registration ID is:

${registrationRow.registration_id}

Please keep this ID safe as it will be used to track your registration.

Our HR team will review your application shortly.

IMPORTANT:
Please login to the portal and upload the required documents to complete your registration.
`;

    let emailSent = false;
    try {
      await transporter.sendMail({
        from: `"HR Department" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Employee Registration Successful",
        text: message,
      });
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send registration email:", emailError);
    }

    const documentsUploaded = await sql`
      SELECT 1
      FROM document_uploads
      WHERE registration_id = ${registrationRow.registration_id}
      LIMIT 1
    `;

    const personalInfo = await sql`
      SELECT 1
      FROM personal_info
      WHERE registration_id = ${registrationRow.registration_id}
      LIMIT 1
    `;

    const employmentInfo = await sql`
      SELECT 1
      FROM employment_info
      WHERE registration_id = ${registrationRow.registration_id}
      LIMIT 1
    `;

    return withCors(req, {
      success: true,
      message: "Registration successful",
      registration_id: registrationRow.registration_id,
      employee_id: registrationRow.registration_id,
      pending_created: true,
      documents_uploaded: documentsUploaded.length > 0,
      personal_information_saved: personalInfo.length > 0,
      employment_information_saved: employmentInfo.length > 0,
      email_sent: emailSent,
      status: "pending_approval",
      current_step: "submitted",
    });
  } catch (error) {
    console.error("Registration error:", error);

    return withCors(
      req,
      {
        success: false,
        message: "Failed to process registration",
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
