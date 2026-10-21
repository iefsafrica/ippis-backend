import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee, employeeAuditStatement } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

const DISCREPANCY_CATEGORIES = ["missing_payment", "incorrect_amount", "incorrect_deduction", "incorrect_allowance", "other"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT id, payment_id, category, description, expected_amount, status, hr_response, handled_at, created_at
      FROM payroll_discrepancies
      WHERE employee_id = ${auth.ctx.employee.id}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("EMPLOYEE DISCREPANCIES LIST ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your reports" }, 500);
  }
}

// Body: { category, description, payment_id?, expected_amount? }
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { category?: unknown; description?: unknown; payment_id?: unknown; expected_amount?: unknown };
    const fields: Record<string, string> = {};

    if (typeof body.category !== "string" || !DISCREPANCY_CATEGORIES.includes(body.category)) {
      fields.category = `category must be one of: ${DISCREPANCY_CATEGORIES.join(", ")}`;
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length < 10) fields.description = "describe the problem in at least 10 characters";

    let expected: number | null = null;
    if (body.expected_amount !== undefined && body.expected_amount !== null && body.expected_amount !== "") {
      expected = Number(body.expected_amount);
      if (!Number.isFinite(expected) || expected < 0) fields.expected_amount = "expected_amount must be a positive number";
    }

    const paymentId = typeof body.payment_id === "string" && body.payment_id.trim() ? body.payment_id.trim() : null;
    if (paymentId) {
      // Only the employee's own payments can be referenced
      const own = await db`SELECT 1 FROM payroll WHERE payment_id = ${paymentId} AND employee_id = ${employee.id}`;
      if (!own[0]) fields.payment_id = "no payment with that id on your record";
    }
    if (body.category === "missing_payment" && paymentId) {
      fields.payment_id = "leave payment_id out for a payment you did not receive";
    }

    if (Object.keys(fields).length > 0) {
      return withCors(req, { success: false, error: "Some values are not valid", fields }, 400);
    }

    const [created] = await db.transaction([
      db`
        INSERT INTO payroll_discrepancies (employee_id, payment_id, category, description, expected_amount)
        VALUES (${employee.id}, ${paymentId}, ${body.category as string}, ${description.slice(0, 2000)}, ${expected})
        RETURNING id, payment_id, category, description, expected_amount, status, created_at
      `,
      employeeAuditStatement(req, employee, "employee.payroll.discrepancy_reported", { category: body.category, payment_id: paymentId }),
    ]);

    return withCors(req, { success: true, message: "Report sent to HR", data: created?.[0] }, 201);
  } catch (error) {
    console.error("EMPLOYEE DISCREPANCY ERROR:", error);
    return withCors(req, { success: false, error: "Failed to send the report" }, 500);
  }
}
