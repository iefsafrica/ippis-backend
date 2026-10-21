import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?employee_id=  An employee's emergency contacts, for HR to use when needed
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.records.view");
    if (!auth.ok) return auth.response;

    const employeeId = new URL(req.url).searchParams.get("employee_id");
    if (!employeeId) {
      return withCors(req, { success: false, error: "employee_id is required" }, 400);
    }

    const employee = await db`SELECT id, name FROM employees WHERE id = ${employeeId}`;
    if (!employee[0]) {
      return withCors(req, { success: false, error: "Employee not found" }, 404);
    }

    const contacts = await db`
      SELECT id, name, relationship, phone, alternate_phone, email, address, is_primary, updated_at
      FROM employee_emergency_contacts
      WHERE employee_id = ${employeeId}
      ORDER BY is_primary DESC, created_at ASC
    `;

    return withCors(req, { success: true, data: { employee: employee[0], contacts } });
  } catch (error) {
    console.error("ADMIN EMERGENCY CONTACTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch emergency contacts" }, 500);
  }
}
