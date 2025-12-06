// app/api/admin/hr/employees/[employee_id]/route.ts
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../../lib/cors";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
// Create Neon client
const sql = neon(process.env.DATABASE_URL!);

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// PATCH: Update employee details
export async function PATCH(req: NextRequest, { params }: { params: { employee_id: string } }) {
  try {
    const employee_id = params.employee_id;

    // Parse request body
    const body = await req.json();
    if (!body || Object.keys(body).length === 0) {
      return withCors(req, {
        success: false,
        error: "Request body is empty. Please provide fields to update.",
      }, 400);
    }

    // Build dynamic SET clause safely
    const fields = Object.keys(body);
    const values = Object.values(body);

    // Generate placeholders: $1, $2, ...
    const setClause = fields.map((f, i) => `"${f}" = $${i + 1}`).join(", ");

    // Add updated_at as the last parameter
    const finalValues = [...values];

    const query = `
      UPDATE employees
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${finalValues.length + 1}
      RETURNING *
    `;

    finalValues.push(employee_id);

    const updated = await sql.query(query, finalValues);

    if (updated.length === 0) {
      return withCors(req, {
        success: false,
        error: "Employee not found.",
      }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Employee details updated successfully.",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating employee:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update employee details.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
