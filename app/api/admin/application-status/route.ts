import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/rbac";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/**
 * GET /api/admin/application-status
 *
 * Returns the application status for the currently authenticated applicant.
 * Uses the JWT's staffId/email to look up the pending_employees or employees table.
 */
export async function GET(req: NextRequest) {
  try {
    // Applicants authenticate through the same JWT flow — just check they're logged in
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const ctx = auth.ctx;
    const email = ctx.user.email as string | undefined;
    const staffId = ctx.userId as string | undefined;

    if (!email && !staffId) {
      return withCors(req, {
        success: false,
        error: "Could not identify applicant from token.",
      }, 400);
    }

    // 1. First check if they've been approved (employees table)
    let employeeRow: any = null;
    if (email) {
      const empRows = await sql`
        SELECT id, name, email, position, department, status, join_date, created_at
        FROM employees
        WHERE email = ${email}
        LIMIT 1
      `;
      if (empRows.length > 0) employeeRow = empRows[0];
    }

    if (employeeRow) {
      return withCors(req, {
        success: true,
        applicationStatus: "approved",
        stage: "employed",
        employeeId: employeeRow.id,
        name: employeeRow.name,
        email: employeeRow.email,
        position: employeeRow.position,
        department: employeeRow.department,
        joinDate: employeeRow.join_date,
        message: "Your application has been approved. You are now an active employee.",
        timeline: [
          { step: "Application Submitted", status: "completed", date: null },
          { step: "Under Review", status: "completed", date: null },
          { step: "Approved", status: "completed", date: employeeRow.created_at },
          { step: "Active Employee", status: "completed", date: employeeRow.join_date },
        ],
      });
    }

    // 2. Check pending_employees
    let pendingRow: any = null;
    if (email) {
      const pendingRows = await sql`
        SELECT registration_id, firstname, surname, email, position, department, status, created_at
        FROM pending_employees
        WHERE email = ${email}
        LIMIT 1
      `;
      if (pendingRows.length > 0) pendingRow = pendingRows[0];
    } else if (staffId) {
      const pendingRows = await sql`
        SELECT registration_id, firstname, surname, email, position, department, status, created_at
        FROM pending_employees
        WHERE registration_id = ${staffId}
        LIMIT 1
      `;
      if (pendingRows.length > 0) pendingRow = pendingRows[0];
    }

    if (pendingRow) {
      const fullName = `${pendingRow.firstname ?? ""} ${pendingRow.surname ?? ""}`.trim();
      const appStatus = pendingRow.status || "pending";

      return withCors(req, {
        success: true,
        applicationStatus: appStatus,
        stage: "under_review",
        registrationId: pendingRow.registration_id,
        name: fullName,
        email: pendingRow.email,
        position: pendingRow.position,
        department: pendingRow.department,
        submittedAt: pendingRow.created_at,
        message:
          appStatus === "rejected"
            ? "Your application has been reviewed and was not approved at this time. Please contact HR for more information."
            : "Your application has been submitted and is currently under review by the HR department. You will be notified once a decision is made.",
        timeline: [
          { step: "Application Submitted", status: "completed", date: pendingRow.created_at },
          { step: "Under Review", status: appStatus === "rejected" ? "failed" : "active", date: null },
          { step: "Approved", status: "pending", date: null },
          { step: "Active Employee", status: "pending", date: null },
        ],
      });
    }

    // Not found in either table
    return withCors(req, {
      success: false,
      applicationStatus: "not_found",
      message: "No application record found for your account. Please contact HR.",
    }, 404);

  } catch (error) {
    console.error("[Application Status] Error:", error);
    return withCors(req, {
      success: false,
      error: "Failed to retrieve application status",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
