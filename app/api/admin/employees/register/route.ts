import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   Types
------------------------- */
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

/* -------------------------
   Mail Transport
------------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

/* -------------------------
   Generate Registration ID (unique)
------------------------- */
async function generateRegistrationId(): Promise<string> {
  let nextIdNum = 1;
  let newId = "";

  while (true) {
    newId = `IPPIS-${String(nextIdNum).padStart(4, "0")}`; // 4 digits
    const existing = await sql`
      SELECT id
      FROM registrations
      WHERE registration_id = ${newId}
    `;
    if (existing.length === 0) break; // ID is unique
    nextIdNum++;
  }

  return newId;
}

/* -------------------------
   Employee Registration
------------------------- */
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
      maritalstatus
    } = body;

    if (!firstname || !surname || !email) {
      return withCors(
        req,
        { success: false, message: "firstname, surname and email are required" },
        400
      );
    }

    const incomingId = body.registration_id?.trim();
    let employeeId = "";
    let registrationId: number | null = null;
    let isExisting = false;

    if (incomingId) {
      const existing = await sql`
        SELECT id FROM registrations WHERE registration_id = ${incomingId}
      `;
      if (existing.length > 0) {
        employeeId = incomingId;
        registrationId = existing[0]?.id;
        isExisting = true;
      } else {
        employeeId = incomingId;
        const inserted = await sql`
          INSERT INTO registrations (registration_id, status)
          VALUES (${employeeId}, 'pending')
          RETURNING id
        `;
        registrationId = inserted[0]?.id;
      }
    } else {
      employeeId = await generateRegistrationId();
      const inserted = await sql`
        INSERT INTO registrations (registration_id, status)
        VALUES (${employeeId}, 'pending')
        RETURNING id
      `;
      registrationId = inserted[0]?.id;
    }

    if (!registrationId) {
      throw new Error("Failed to create or resolve registration");
    }

    if (!isExisting) {
      /* -------------------------
         Insert into VerificationData table
         Use UUID for 'id'
      ------------------------- */
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
          ${nin ?? null},
          ${firstname},
          ${surname},
          ${middlename ?? null},
          ${email},
          ${gender ?? null},
          ${telephoneno ?? null},
          ${birthdate ?? null},
          ${state_of_origin ?? null},
          ${residence_address ?? null},
          ${residence_state ?? null},
          ${residence_lga ?? null},
          ${profession ?? null},
          ${maritalstatus ?? null}
        )
      `;

      /* -------------------------
         Insert into pending_employees table
      ------------------------- */
      await sql`
        INSERT INTO pending_employees (
          registration_id,
          email,
          firstname,
          surname,
          status
        )
        VALUES (
          ${employeeId},
          ${email},
          ${firstname},
          ${surname},
          'pending'
        )
      `;
    }


    /* -------------------------
       Send Email
       Always prompt user to upload documents
    ------------------------- */
    const message = `Dear ${firstname},

Your employee registration has been received successfully.

Your Employee Registration ID is:

${employeeId}

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
      console.log(`Registration email sent successfully to ${email}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send registration email:", emailError);
      // Continue with registration even if email fails
    }

    /* -------------------------
       Check if documents have been uploaded
    ------------------------- */
    const documentsUploaded = await sql`
      SELECT 1 FROM document_uploads WHERE registration_id = ${employeeId}
    `;

    /* -------------------------
       Check if personal info exists
    ------------------------- */
    const personalInfo = await sql`
      SELECT 1 FROM personal_info WHERE registration_id = ${employeeId}
    `;

    /* -------------------------
       Check if employment info exists
    ------------------------- */
    const employmentInfo = await sql`
      SELECT 1 FROM employee_info WHERE registration_id = ${employeeId}
    `;

    return withCors(req, {
      success: true,
      message: "Registration successful",
      employee_id: employeeId,
      documents_uploaded: documentsUploaded.length > 0,
      personal_information_saved: personalInfo.length > 0,
      employment_information_saved: employmentInfo.length > 0,
      email_sent: emailSent,
    });

  } catch (error) {
    console.error("Registration error:", error);

    return withCors(req, {
      success: false,
      message: "Failed to process registration",
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}