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

// ?year=  Public holidays for the year
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const year = Number(new URL(req.url).searchParams.get("year") || todayLagos().slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return withCors(req, { success: false, error: "year is not valid" }, 400);
    }

    const rows = await db`
      SELECT id, holiday_name, start_date::date::text AS start_date,
             COALESCE(end_date, start_date)::date::text AS end_date, description,
             (COALESCE(end_date, start_date)::date - start_date::date) + 1 AS days
      FROM holidays
      WHERE LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'cancelled', 'disabled')
        AND start_date::date <= ${`${year}-12-31`}::date
        AND COALESCE(end_date, start_date)::date >= ${`${year}-01-01`}::date
      ORDER BY start_date
    `;
    const today = todayLagos();
    return withCors(req, {
      success: true,
      data: { year, holidays: rows, upcoming: rows.filter((h: any) => h.end_date >= today).slice(0, 5) },
    });
  } catch (error) {
    console.error("EMPLOYEE HOLIDAYS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load public holidays" }, 500);
  }
}
