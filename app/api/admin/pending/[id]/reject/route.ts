import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { registrationInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { sendEmployeeRejectionEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

// Neon client
const sql = neon(process.env.DATABASE_URL!);

//  Helper: check if table exists
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      )
    `;
    return result[0]?.exists ?? false;
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error);
    return false;
  }
}

//  Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

//  PATCH: Reject pending employee (Next.js build-safe)
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "employees.registrations.approve");
    if (!auth.ok) return auth.response;

    console.log("Rejecting pending employee...");

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const registrationId = decodeURIComponent(
      pathParts[pathParts.length - 2] || ""
    ).trim();

    if (!registrationId) {
      return withCors(
        req,
        { success: false, error: "Registration ID is required in the URL." },
        400
      );
    }

    // Only registrations inside the caller's MDA or department scope
    if (!(await registrationInScope(auth.ctx, "employees.registrations.approve", registrationId))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const pendingExists = await tableExists("pending_employees");
    if (!pendingExists) {
      return withCors(
        req,
        {
          success: false,
          error: "pending_employees table does not exist.",
        },
        404
      );
    }

    const pendingEmployeeResult = await sql`
      SELECT * FROM pending_employees WHERE registration_id = ${registrationId}
    `;
    const pendingEmployee = pendingEmployeeResult[0];

    if (!pendingEmployee) {
      return withCors(
        req,
        {
          success: false,
          error: `Pending employee with registration ID ${registrationId} not found.`,
        },
        404
      );
    }

    //  Delete from pending_employees
    await sql`DELETE FROM pending_employees WHERE registration_id = ${registrationId}`;

    const fullName =
      `${pendingEmployee.surname ?? ""} ${pendingEmployee.firstname ?? ""}`.trim() ||
      "Employee";

    //  Generate reapplication link
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://ippis-frontend.vercel.app";
    const reapplyUrl = `${baseUrl}/reapply?email=${encodeURIComponent(
      pendingEmployee.email
    )}&id=${encodeURIComponent(registrationId)}`;

    // Send rejection email (HTML template with reapplication link)
    if (pendingEmployee.email) {
      await sendEmployeeRejectionEmail({
        to: pendingEmployee.email,
        fullName,
        reapplyUrl,
      }).catch((emailError) => {
        console.error("⚠️ Failed to send rejection email:", emailError);
      });
    } else {
      console.warn("⚠️ Skipping rejection email — no valid email found.");
    }

    //  Return success response
    await runAudited(req, auth.ctx, {
      action: "employees.registration.rejected",
      targetType: "registration",
      targetId: registrationId,
      details: {},
    }, []);

    return withCors(req, {
      success: true,
      message: `Pending employee ${registrationId} has been rejected and removed from the pending list.`,
      data: {
        registration_id: registrationId,
        name: fullName,
        email: pendingEmployee.email,
        reapply_url: reapplyUrl,
      },
    });
  } catch (error) {
    console.error("Error rejecting employee:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to reject employee.",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
