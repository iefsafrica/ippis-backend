import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Ends every session of the signed-in employee, so the token stops working at once
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    await db`
      UPDATE employee_accounts
      SET token_version = token_version + 1, updated_at = NOW()
      WHERE employee_id = ${auth.ctx.employee.id}
    `;

    const response = withCors(req, { success: true, message: "Signed out" });
    response.cookies.set("token", "", { expires: new Date(0), path: "/" });
    return response;
  } catch (error) {
    console.error("EMPLOYEE LOGOUT ERROR:", error);
    return withCors(req, { success: false, message: "Something went wrong during sign-out" }, 500);
  }
}
