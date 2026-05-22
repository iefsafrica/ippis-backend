import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import Papa from "papaparse";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// OPTIONS (CORS preflight)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// POST: Import Attendance CSV
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return withCors(req, { success: false, message: "CSV file is required" }, 400);
    }

    const text = await file.text();

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (!parsed.data || parsed.data.length === 0) {
      return withCors(req, { success: false, message: "CSV is empty or invalid" }, 400);
    }

    let imported = 0;
    let skipped = 0;
    const errors: { employee_code: string; reason: string }[] = [];

    for (const row of parsed.data as any[]) {
      const employee_code = row.employee_code?.trim();
      const attendance_date = row.attendance_date?.trim();
      const clock_in = row.clock_in?.trim() || null;
      const clock_out = row.clock_out?.trim() || null;
      const status = row.status?.trim();
      const notes = row.notes?.trim() || null;

      if (!employee_code || !attendance_date || !status) {
        errors.push({ employee_code: employee_code ?? "UNKNOWN", reason: "Missing required fields" });
        skipped++;
        continue;
      }

      // Check employee exists
      const employeeResult = await sql`
        SELECT id, name, department
        FROM employees
        WHERE id = ${employee_code}
        LIMIT 1
      `;
      const employee = employeeResult[0];
      if (!employee) {
        errors.push({ employee_code, reason: "Employee not found" });
        skipped++;
        continue;
      }

      // Prevent duplicate attendance
      const existing = await sql`
        SELECT id
        FROM attendance
        WHERE employee_code = ${employee_code} AND attendance_date = ${attendance_date}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skipped++;
        continue; // silently skip duplicates
      }

      // Insert attendance
      await sql`
        INSERT INTO attendance (
          employee_code,
          employee_name,
          department,
          attendance_date,
          clock_in,
          clock_out,
          status,
          notes
        ) VALUES (
          ${employee.id},
          ${employee.name},
          ${employee.department ?? null},
          ${attendance_date},
          ${clock_in},
          ${clock_out},
          ${status},
          ${notes}
        )
      `;

      imported++;
    }

    return withCors(req, { success: true, imported, skipped, errors });
  } catch (error) {
    console.error("Attendance CSV import error:", error);
    return withCors(req, { success: false, message: "Unexpected error during CSV import" }, 500);
  }
}