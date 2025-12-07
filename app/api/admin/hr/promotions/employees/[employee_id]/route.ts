// app/api/admin/hr/employees/[employee_id]/route.ts
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../../lib/cors";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// OPTIONS
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// PATCH — Update employee
export async function PATCH(
  req: NextRequest,
  context: { params: { employee_id: string } }
) {
  try {
    const employee_id = context.params.employee_id;

    if (!employee_id) {
      return withCors(req, { success: false, error: "Employee ID missing." }, 400);
    }

    const allowedFields = ["name", "email", "department", "position", "status"];

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return withCors(
        req,
        { success: false, error: "Invalid JSON body." },
        400
      );
    }

    const updates = Object.entries(body).filter(([key]) =>
      allowedFields.includes(key)
    );

    if (updates.length === 0) {
      return withCors(
        req,
        { success: false, error: "No valid fields to update." },
        400
      );
    }

    // Build SET clause
    const setExpressions = updates.map(
      ([key], i) => `${key} = $${i + 1}`
    );

    const values = updates.map(([, val]) => val);

    // Add employee ID at the end
    values.push(employee_id);

    const query = `
      UPDATE employees
      SET ${setExpressions.join(", ")},
          updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const rows = await sql.query(query, values);

    if (!rows || rows.length === 0) {
      return withCors(req, { success: false, error: "Employee not found." }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Employee details updated successfully.",
      data: rows[0],
    });
  } catch (error) {
    console.error("Update error:", error);

    return withCors(
      req,
      {
        success: false,
        error: "Failed to update employee details.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
