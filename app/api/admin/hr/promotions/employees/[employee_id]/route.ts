import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { headers } from "next/headers";

const sql = neon(process.env.DATABASE_URL!);

// OPTIONS
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// PATCH — Update employee details
export async function PATCH(req: NextRequest) {
  try {
    //  FIX: headers() is async in Edge Runtime
    const h = await headers();
    const employee_id = h.get("x-nextjs-param-employee_id");

    if (!employee_id) {
      return withCors(
        req,
        { success: false, error: "Missing employee_id parameter." },
        400
      );
    }

    const allowedFields = ["name", "email", "department", "position", "status"];

    // Read body
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return withCors(req, { success: false, error: "Invalid JSON body." }, 400);
    }

    const updates = Object.entries(body).filter(([key]) =>
      allowedFields.includes(key)
    );

    if (updates.length === 0) {
      return withCors(req, {
        success: false,
        error: "No valid fields provided for update.",
      });
    }

    const setExpr = updates.map(([key], idx) => `${key} = $${idx + 1}`);
    const values = updates.map(([, value]) => value);

    values.push(employee_id);

    const query = `
      UPDATE employees
      SET ${setExpr.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await sql.query(query, values);

    if (!result || result.length === 0) {
      return withCors(req, { success: false, error: "Employee not found." }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Employee details updated successfully.",
      data: result[0],
    });
  } catch (err: any) {
    return withCors(
      req,
      {
        success: false,
        error: "Failed to update employee details.",
        details: err?.message ?? String(err),
      },
      500
    );
  }
}
