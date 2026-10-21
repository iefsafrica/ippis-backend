import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { shiftFor, shiftMinutes } from "@/lib/employee-attendance";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// The employee's shift and working hours, and every active shift for their department
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const current = await shiftFor(employee.department);
    let all: any[] = [];
    try {
      all = await db`
        SELECT shift_name, start_time::text AS start_time, end_time::text AS end_time,
               late_mark_time::text AS late_mark_time, department
        FROM office_shifts
        WHERE LOWER(COALESCE(status, 'active')) IN ('active', 'enabled')
          AND (department IS NULL OR department = '' OR LOWER(department) IN (LOWER(${employee.department ?? ""}), 'all'))
        ORDER BY start_time
      `;
    } catch (error) {
      console.error("EMPLOYEE SHIFTS LIST:", error);
    }

    return withCors(req, {
      success: true,
      data: {
        current: { ...current, hoursPerDay: Math.round((shiftMinutes(current) / 60) * 100) / 100 },
        workingDays: "Monday to Friday",
        shifts: all,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE SHIFT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your shift" }, 500);
  }
}
