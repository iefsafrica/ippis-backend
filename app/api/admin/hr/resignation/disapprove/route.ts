import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, disapproved_by, reason } = (await req.json()) as {
      id?: number;
      disapproved_by?: string;
      reason?: string;
    };

    if (!id || !disapproved_by) {
      return withCors(req, {
        success: false,
        error: "id and disapproved_by are required.",
      }, 400);
    }

    const existing = await sql`
      SELECT * FROM employee_resignations WHERE id = ${id}
    `;

    if (!existing[0]) {
      return withCors(req, { success: false, error: "Resignation not found." }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending resignations can be disapproved.",
      }, 400);
    }

    const disapproved = await sql`
      UPDATE employee_resignations
      SET
        status = 'disapproved',
        disapproved_by = ${disapproved_by},
        disapproved_at = NOW(),
        disapproval_reason = ${reason},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!disapproved[0]) {
      return withCors(req, { success: false, error: "Disapproval failed." }, 500);
    }

    return withCors(req, {
      success: true,
      message: "Resignation disapproved successfully",
      data: disapproved[0],
    });
  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to disapprove resignation.",
    }, 500);
  }
}
