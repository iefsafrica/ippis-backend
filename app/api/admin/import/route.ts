import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";
import { NextRequest } from "next/server";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

// Neon client
const sql = neon(process.env.DATABASE_URL!);

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    // Parse form-data
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return withCors(req, { success: false, error: "CSV file is required" }, 400);
    }

    const text = await file.text();

    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      return withCors(req, {
        success: false,
        error: "CSV parsing error",
        details: parsed.errors,
      }, 400);
    }

    const rows = parsed.data as Record<string, string>[];
    if (rows.length === 0) {
      return withCors(req, { success: false, error: "CSV is empty" }, 400);
    }

    const insertedEmployees = [];

    for (const row of rows) {
      const registrationId = row.EmploymentIdNo || `REG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const jsonData = {
        GL: row.GL,
        LGA: row.LGA,
        Step: row.Step,
        Cadre: row.Cadre,
        Email: row.Email,
        Title: row.Title,
        Gender: row.Sex || row.Gender,
        Salary: row.Salary,
        "File No": row.FileNo,
        "RSA PIN": row.RSAPIN,
        Surname: row.Surname,
        "PFA Name": row.PFAName,
        Position: row.RankPosition || row.Position,
        "Bank Name": row.NameOfBank,
        FirstName: row.FirstName,
        Department: row.Department,
        "Service No": row.ServiceNo,
        "Employee ID": row.EmploymentIdNo,
        "Other Names": row.OtherNames,
        "BVN Verified": row["BVN Verified"] || null,
        "NIN Verified": row["NIN Verified"] || null,
        Organization: row.Organization,
        "Phone Number": row.PhoneNumber,
        "Date of Birth": row.DateOfBirth,
        "Work Location": row.WorkLocation,
        "Account Number": row.AccountNumber,
        "Marital Status": row.MaritalStatus,
        "Payment Method": row.PaymentMethod || "Bank Transfer",
        "Employment Type": row.EmploymentType,
        "State of Origin": row.StateOfOrigin,
        "Next of Kin Name": row.NextOfKinName,
        "Probation Period": row.ProbationPeriod,
        "Salary Structure": row.SalaryStructure,
        "Next of Kin Phone": row.NextOfKinPhoneNumber,
        "State of Residence": row.StateOfResidence,
        "Next of Kin Address": row.NextOfKinAddress,
        "Residential Address": row.AddressStateOfResidence,
        "Next of Kin Relationship": row["Next Of Kin Relationship"],
        "Date of First Appointment": row.DateOfFirstAppointment,
        Certifications: row.Certifications,
        EducationalBackground: row.EducationalBackground,
        Declaration: row.Declaration,
      };

      const result = await sql`
        INSERT INTO pending_employees (
          registration_id,
          surname,
          firstname,
          email,
          department,
          position,
          status,
          source,
          created_at,
          updated_at,
          metadata
        ) VALUES (
          ${registrationId},
          ${row.Surname},
          ${row.FirstName},
          ${row.Email},
          ${row.Department},
          ${row.RankPosition || row.Position},
          'pending_approval',
          'import',
          NOW(),
          NOW(),
          ${JSON.stringify(jsonData)}
        )
        RETURNING *
      `;
      insertedEmployees.push(result[0]);
    }

    return withCors(req, {
      success: true,
      message: `${insertedEmployees.length} pending employees imported successfully`,
      data: insertedEmployees,
    });

  } catch (error) {
    console.error("CSV import error:", error);
    return withCors(req, {
      success: false,
      error: "Failed to import pending employees",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
