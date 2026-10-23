import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { registrationInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { inviteToPortal } from "@/lib/employee-invite";
import { linkEmployeeToMda } from "@/lib/employee-mda";
import { sendEmployeeApprovalEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

async function tableExists(tableName: string) {
  const result = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = ${tableName}
    )
  `;
  return result[0]?.exists ?? false;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.registrations.approve");
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const registrationId = decodeURIComponent(
      url.pathname.split("/").reverse()[1] ?? ""
    ).trim();

    if (!registrationId) {
      return withCors(
        req,
        { success: false, error: "Registration ID is required." },
        400
      );
    }

    // Only registrations inside the caller's MDA or department scope
    if (!(await registrationInScope(auth.ctx, "employees.registrations.approve", registrationId))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    // Ensure required tables exist
    const [pendingExists, employeesExists] = await Promise.all([
      tableExists("pending_employees"),
      tableExists("employees"),
    ]);

    if (!pendingExists || !employeesExists) {
      return withCors(
        req,
        { success: false, error: "Required tables do not exist." },
        500
      );
    }

    // Check if already migrated
    const alreadyExistingEmployee = await sql`
      SELECT * FROM employees WHERE registration_id = ${registrationId}
    `;

    if (alreadyExistingEmployee.length > 0) {
      return withCors(
        req,
        {
          success: false,
          message: "This employee has already been approved.",
          employee: alreadyExistingEmployee[0],
        },
        409
      );
    }

    // Fetch pending employee
    const existingPending = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;

    const pending = existingPending[0];
    if (!pending) {
      return withCors(
        req,
        { success: false, error: `No pending employee found for ${registrationId}.` },
        404
      );
    }

    const fullName =
      `${pending.surname ?? ""} ${pending.firstname ?? ""}`.trim() ||
      pending.name ||
      "Unnamed Employee";

    const newEmployeeId = `IPPIS${Math.floor(
      100000 + Math.random() * 900000
    )}`;

    // Insert employee and save metadata as JSONB
    const [insertedEmployee] = await sql`
      INSERT INTO employees (
        id, registration_id, name, email, position, department, status,
        metadata, join_date, created_at, updated_at
      )
      VALUES (
        ${newEmployeeId},
        ${pending.registration_id},
        ${fullName},
        ${pending.email || "no-email@example.com"},
        ${pending.position || "Not Assigned"},
        ${pending.department || "Unassigned"},
        'active',
        ${pending.metadata ? JSON.stringify(pending.metadata) : "{}"},
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    // Link the employee to the MDA and department named at registration (exact matches only;
    // anything else is left for HR in /api/admin/employees/mda-mapping)
    await linkEmployeeToMda(String(insertedEmployee?.id ?? newEmployeeId), auth.ctx.user.username);

    // Invite the employee to the employee portal, where they set their own password.
    // A failed invite does not block the approval; HR can resend it from Employee accounts.
    const invite = await inviteToPortal(String(insertedEmployee?.id ?? newEmployeeId), auth.ctx.user.username);
    if (!invite.ok) console.error(`Employee portal invite for ${String(insertedEmployee?.id ?? newEmployeeId)} not sent:`, invite.error);

    // Send official HTML employment approval email (portal sign-in comes from the invite)
    if (insertedEmployee?.email && insertedEmployee.email !== "no-email@example.com") {
      await sendEmployeeApprovalEmail({
        to: insertedEmployee.email,
        fullName,
        employeeId: insertedEmployee.id,
        position: insertedEmployee.position || undefined,
        department: insertedEmployee.department || undefined,
      }).catch((err) => {
        console.error("Employee approval email send failed:", err);
      });
    }

    // DELETE from pending_employees AFTER successful migration
    await sql`
      DELETE FROM pending_employees WHERE registration_id = ${registrationId}
    `;

    await runAudited(req, auth.ctx, {
      action: "employees.registration.approved",
      targetType: "registration",
      targetId: registrationId,
      details: {},
    }, []);

    return withCors(req, {
      success: true,
      message: "Employee approved, migrated, and removed from pending list.",
      data: insertedEmployee,
    });

  } catch (error) {
    console.error("Approval failed:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Employee approval failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
