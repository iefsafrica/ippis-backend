import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { todayLagos } from "@/lib/employee-time";
import { leaveBalances } from "@/lib/employee-leave";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?year=  Days allowed, taken, pending and available per leave type
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const current = Number(todayLagos().slice(0, 4));
    const year = Number(new URL(req.url).searchParams.get("year") || current);
    if (!Number.isInteger(year) || year < current - 5 || year > current + 1) {
      return withCors(req, { success: false, error: `year must be between ${current - 5} and ${current + 1}` }, 400);
    }

    return withCors(req, {
      success: true,
      data: {
        year,
        // Leave counts working days; weekends and public holidays are not deducted
        countedIn: "working days",
        balances: await leaveBalances(auth.ctx.employee.id, year),
      },
    });
  } catch (error) {
    console.error("EMPLOYEE LEAVE BALANCES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your leave balances" }, 500);
  }
}
