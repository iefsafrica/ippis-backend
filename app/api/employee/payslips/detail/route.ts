import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { payslipsFor } from "@/lib/employee-payroll";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?payment_id=  One payslip with earnings, deductions, tax and pension
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const paymentId = new URL(req.url).searchParams.get("payment_id");
    if (!paymentId) return withCors(req, { success: false, error: "payment_id is required" }, 400);

    const [payslip] = await payslipsFor(auth.ctx.employee.id, { paymentId });
    if (!payslip) return withCors(req, { success: false, error: "Payslip not found" }, 404);

    return withCors(req, { success: true, data: payslip });
  } catch (error) {
    console.error("EMPLOYEE PAYSLIP DETAIL ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load the payslip" }, 500);
  }
}
