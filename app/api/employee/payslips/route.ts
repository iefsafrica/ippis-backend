import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { todayLagos } from "@/lib/employee-time";
import { payslipsFor, payrollInProgress } from "@/lib/employee-payroll";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const sum = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;

// ?year=  Released payslips (payment history) with year-to-date pay, tax and pension
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const yearParam = new URL(req.url).searchParams.get("year");
    const year = yearParam ? Number(yearParam) : null;
    if (yearParam && (!Number.isInteger(year) || year! < 2000 || year! > 2100)) {
      return withCors(req, { success: false, error: "year is not valid" }, 400);
    }

    const [payslips, inProgress] = await Promise.all([
      payslipsFor(employee.id, { year: year ?? undefined }),
      payrollInProgress(employee.id),
    ]);
    const summaryYear = year ?? Number(todayLagos().slice(0, 4));
    const inYear = payslips.filter((p) => p.paymentDate?.startsWith(String(summaryYear)));

    return withCors(req, {
      success: true,
      data: {
        payslips: payslips.map((p) => ({
          paymentId: p.paymentId,
          paymentDate: p.paymentDate,
          type: p.type,
          status: p.status,
          amountPaid: p.amountPaid,
          gross: p.gross,
          totalDeductions: p.totalDeductions,
        })),
        paymentsInProgress: inProgress,
        yearToDate: {
          year: summaryYear,
          payments: inYear.length,
          totalPaid: sum(inYear.map((p) => p.amountPaid)),
          gross: sum(inYear.map((p) => p.gross)),
          tax: sum(inYear.map((p) => p.tax)),
          pension: sum(inYear.map((p) => p.pension)),
        },
      },
    });
  } catch (error) {
    console.error("EMPLOYEE PAYSLIPS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your payslips" }, 500);
  }
}
