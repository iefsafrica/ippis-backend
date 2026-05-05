import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";
import {
  canonicalizeRegistrationId,
  normalizeRegistrationId,
} from "../../../../../lib/registration-id";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";

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

import { generateRegistrationId } from "../../../../../lib/register-utils";

// Nodemailer transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
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
    const email = body.email?.trim();
    const department = body.department?.trim();
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

    // Ensure pending_employees table exists (basic check)
    if (!(await tableExists("pending_employees"))) {
      return withCors(req, { success: false, error: "The 'pending_employees' table does not exist." }, 404);
    }

    // Check if email already exists
    const emailExists = await sql`SELECT 1 FROM pending_employees WHERE email = ${email} LIMIT 1`;
    if (emailExists.length > 0) {
      return withCors(req, { success: false, error: "This email is already registered." }, 400);
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

    // 4. Insert into pending_employees
    const inserted = await sql`
      INSERT INTO pending_employees
        (registration_id, firstname, surname, email, department, position, source, submission_date, created_at, updated_at)
      VALUES
        (${registrationId}, ${firstname}, ${surname}, ${email}, ${department || null}, ${position || null}, 'form', NOW(), NOW(), NOW())
      RETURNING *
    `;
    const employee = inserted[0];

    // 5. Send Email
    const baseUrl = process.env.APP_URL || "https://ipphis.com";
    const registrationLink = `${baseUrl}/register?email=${encodeURIComponent(email)}`;
    
    const message = `Dear ${firstname},

Your employee profile has been created in the IPPHIS system by an administrator.

Your Employee Registration ID is: ${registrationId}

Please login to the portal and upload your required documents to complete your onboarding process:
${registrationLink}

Thank you,
The IPPHIS Team`;

    try {
      await transporter.sendMail({
        from: `"HR Department" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Welcome to IPPHIS - Action Required",
        text: message,
      });
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
    }

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
