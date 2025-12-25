import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// PUT – Approve resignation
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: number;
      approved_by?: string;
    };

    const { id, approved_by } = body;

    if (!id) {
      return withCors(
        req,
        { success: false, error: "Resignation id is required for approval." },
        400
      );
    }

    if (!approved_by) {
      return withCors(
        req,
        { success: false, error: "approved_by is required." },
        400
      );
    }

    // Check resignation exists
    const resignation = await sql`
      SELECT * FROM employee_resignations WHERE id = ${id}
    `;

    if (!resignation[0]) {
      return withCors(
        req,
        { success: false, error: "Resignation not found." },
        404
      );
    }

    if (resignation[0].status !== "pending") {
      return withCors(
        req,
        { success: false, error: "Only pending resignations can be approved." },
        400
      );
    }

    // Approve resignation
    const approved = await sql`
      UPDATE employee_resignations
      SET
        status = 'approved',
        approved_by = ${approved_by},
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    // 🔐 SAFETY CHECK (important for TS + runtime)
    if (!approved[0]) {
      return withCors(
        req,
        { success: false, error: "Failed to approve resignation." },
        500
      );
    }

    // 🔁 Update employee status
    await sql`
      UPDATE employees
      SET
        status = 'resigned',
        updated_at = NOW()
      WHERE id = ${approved[0].employee_id}
    `;

    return withCors(req, {
      success: true,
      message: "Employee resignation approved successfully",
      data: approved[0],
    });
  } catch (error) {
    console.error("Error approving resignation:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to approve resignation.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
