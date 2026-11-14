import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { sendTerminationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// POST: Send/resend official termination email to an employee
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "corehr.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const employeeId = body.employee_id || body.employeeId || body.id;

    if (!employeeId || typeof employeeId !== "string") {
      return withCors(req, { success: false, error: "Valid employee_id is required" }, 400);
    }

    // Verify employee exists and check MDA scope
    const empRows = await sql`
      SELECT 
        e.id,
        e.name,
        e.email,
        e.position,
        e.department,
        e.company_id,
        c.name AS mda_name,
        p.email AS p_email,
        p.first_name AS p_first_name,
        p.surname AS p_surname
      FROM employees e
      LEFT JOIN companies c ON c.id = e.company_id
      LEFT JOIN personal_info p ON (p.registration_id = e.registration_id OR p.registration_id = e.id)
      WHERE e.id = ${employeeId} OR e.registration_id = ${employeeId}
      LIMIT 1
    `;

    const emp = empRows[0];
    if (!emp) {
      return withCors(req, { success: false, error: `Employee '${employeeId}' not found` }, 404);
    }

    if (!(await employeeInScope(auth.ctx, "corehr.records.manage", emp.id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 403);
    }

    const recipientEmail = body.custom_recipient_email || emp.email || emp.p_email;
    if (!recipientEmail) {
      return withCors(
        req,
        {
          success: false,
          error: `No valid email address found on file for employee '${employeeId}'. Provide 'custom_recipient_email' in the request body.`,
        },
        400
      );
    }

    const fullName = emp.name || [emp.p_first_name, emp.p_surname].filter(Boolean).join(" ") || "Civil Service Officer";
    const terminationType = body.termination_type || "Standard Termination";
    const terminationReason = body.termination_reason || body.reason || undefined;
    const terminationDate = body.termination_date || body.effective_date || new Date().toISOString().slice(0, 10);
    const noticePeriod = body.notice_period || undefined;

    const emailResult = await sendTerminationEmail({
      to: recipientEmail,
      fullName,
      employeeId: String(emp.id),
      position: emp.position || undefined,
      department: emp.department || undefined,
      mdaName: emp.mda_name || undefined,
      terminationType,
      terminationReason,
      terminationDate,
      noticePeriod,
    });

    if (!emailResult) {
      return withCors(
        req,
        {
          success: false,
          error: "Failed to dispatch termination email. Ensure SMTP credentials are configured.",
        },
        500
      );
    }

    await runAudited(
      req,
      auth.ctx,
      {
        action: "corehr.termination.email_sent",
        targetType: "employee",
        targetId: String(emp.id),
        details: {
          recipient: recipientEmail,
          terminationType,
          terminationDate,
        },
      },
      []
    );

    return withCors(req, {
      success: true,
      message: `Official termination notification email sent successfully to ${recipientEmail}`,
      data: {
        employeeId: emp.id,
        recipient: recipientEmail,
        terminationType,
        terminationDate,
        messageId: emailResult.messageId,
      },
    });
  } catch (error: any) {
    console.error("SEND TERMINATION EMAIL ERROR:", error);
    return withCors(req, { success: false, error: "Failed to send termination email", details: error?.message }, 500);
  }
}
