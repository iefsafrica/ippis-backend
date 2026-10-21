import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { todayLagos } from "@/lib/employee-time";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Training programmes the employee is enrolled in, upcoming first
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT t.id, t.training_title, t.type, t.trainer, t.start_date::date::text AS start_date, t.status AS training_status,
             en.status AS enrollment_status, en.enrolled_at
      FROM training_enrollments en
      JOIN training_programs t ON t.id = en.training_id
      WHERE en.employee_id = ${auth.ctx.employee.id} AND en.status <> 'withdrawn'
      ORDER BY t.start_date ASC
    `;
    const today = todayLagos();
    return withCors(req, {
      success: true,
      data: {
        upcoming: rows.filter((r: any) => r.start_date >= today && r.enrollment_status === "enrolled"),
        past: rows.filter((r: any) => r.start_date < today || r.enrollment_status === "completed"),
      },
    });
  } catch (error) {
    console.error("EMPLOYEE TRAININGS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your training" }, 500);
  }
}
