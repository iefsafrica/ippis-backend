import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { namesDestination, resolveDestination, unitOf, coversEitherEnd, type Destination } from "@/lib/employee-transfer";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/**
 * Transfers (ORG-05). A transfer is requested here and decided through
 * /api/admin/hr/transfer/decide: pending -> approved -> completed, or rejected
 * or cancelled. Completing it moves the employee and reassesses their access.
 *
 * The destination is named by id (to_company_id, to_department_id,
 * to_designation_id, to_location_id). A transfer with only the text fields can
 * still be saved, but needs a destination before it can be approved.
 */

const VIEW = "corehr.records.view";
const MANAGE = "corehr.records.manage";

// Transfer payload type
interface TransferPayload {
  id?: number;

  employee_id: string;
  employee_name: string;

  from_department?: string;
  to_department?: string;

  from_position?: string;
  to_position?: string;

  from_location?: string;
  to_location?: string;

  to_company_id?: number;
  to_mda_id?: number;
  to_department_id?: number;
  to_designation_id?: number;
  to_location_id?: number;

  effective_date: string; // ISO
  reason?: string;
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET transfers (all, by id, or by employee_id)  ?status=
// Lists transfers of employees in the caller's scope, and transfers coming into it.
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, VIEW);
    if (!auth.ok) return auth.response;

    const id = req.nextUrl.searchParams.get("id");
    const employee_id = req.nextUrl.searchParams.get("employee_id");
    const status = req.nextUrl.searchParams.get("status");
    const sc = recordScope(auth.ctx, VIEW);

    const records = await sql`
      SELECT t.*, t.effective_date::text AS effective_date,
             fc.name AS from_mda_name, fd.name AS from_department_name,
             tc.name AS to_mda_name, td.name AS to_department_name,
             tdes.title AS to_designation_title, tl.name AS to_location_name
      FROM employee_transfers t
      LEFT JOIN employees e ON e.id = t.employee_id
      LEFT JOIN companies fc ON fc.id = COALESCE(t.from_company_id, e.company_id)
      LEFT JOIN departments fd ON fd.id = COALESCE(t.from_department_id, e.department_id)
      LEFT JOIN companies tc ON tc.id = t.to_company_id
      LEFT JOIN departments td ON td.id = t.to_department_id
      LEFT JOIN designations tdes ON tdes.id = t.to_designation_id
      LEFT JOIN locations tl ON tl.id = t.to_location_id
      WHERE (${id}::text IS NULL OR t.id::text = ${id})
        AND (${employee_id}::text IS NULL OR t.employee_id = ${employee_id})
        AND (${status}::text IS NULL OR t.status = ${status})
        AND (${sc.all}::boolean
             OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[])
             OR t.to_company_id = ANY(${sc.companyIds}::int[]) OR t.to_department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY t.created_at DESC
    `;

    return withCors(req, { success: true, data: records });
  } catch (error) {
    console.error("Error fetching transfer records:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch transfer records.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// POST new transfer request
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Partial<TransferPayload> | null;
    if (!body) {
      return withCors(req, { success: false, error: "Send the transfer as JSON" }, 400);
    }
    const { employee_id, employee_name, effective_date } = body;

    if (!employee_id || !employee_name || !effective_date) {
      return withCors(req, {
        success: false,
        error: "employee_id, employee_name and effective_date are required.",
      }, 400);
    }

    // Validate employee
    const employee = await sql`
      SELECT * FROM employees
      WHERE id = ${employee_id}
      AND name = ${employee_name}
    `;

    if (!employee[0]) {
      return withCors(req, {
        success: false,
        error: `Employee ID ${employee_id} does not match name "${employee_name}"`,
      }, 400);
    }
    // The request is made by HR responsible for the employee; the destination may be elsewhere
    if (!(await employeeInScope(auth.ctx, MANAGE, employee[0].id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const current = unitOf(employee[0]);
    let destination: Destination | null = null;
    if (namesDestination(body as Record<string, unknown>)) {
      const resolved = await resolveDestination(body as Record<string, unknown>, current);
      if (!resolved.ok) return withCors(req, { success: false, error: resolved.error }, 400);
      destination = resolved.destination;
    }

    const [from] = await sql`SELECT name FROM departments WHERE id = ${current.departmentId}`;

    const [result] = await runAudited(
      req,
      auth.ctx,
      { action: "corehr.transfer.created", targetType: "employee", targetId: employee_id, reason: readReason(body.reason), details: { effective_date, to: destination } },
      [sql`
        INSERT INTO employee_transfers (
          employee_id, employee_name,
          from_department, to_department, from_position, to_position, from_location, to_location,
          from_company_id, from_department_id, from_designation_id, from_location_id,
          to_company_id, to_department_id, to_designation_id, to_location_id,
          effective_date, reason, status, requested_by, created_at, updated_at
        )
        VALUES (
          ${employee_id}, ${employee_name},
          ${body.from_department ?? from?.name ?? employee[0].department ?? null},
          ${body.to_department ?? destination?.departmentName ?? null},
          ${body.from_position ?? employee[0].position ?? null},
          ${body.to_position ?? destination?.designationTitle ?? null},
          ${body.from_location ?? null},
          ${body.to_location ?? destination?.locationName ?? null},
          ${current.companyId}, ${current.departmentId}, ${current.designationId}, ${current.locationId},
          ${destination?.companyId ?? null}, ${destination?.departmentId ?? null},
          ${destination?.designationId ?? null}, ${destination?.locationId ?? null},
          ${effective_date}, ${body.reason ?? null}, 'pending', ${auth.ctx.user.username}, NOW(), NOW()
        )
        RETURNING *
      `]
    );

    return withCors(req, {
      success: true,
      message: destination
        ? "Transfer requested; it now needs approval"
        : "Transfer saved. Set the destination (to_company_id or to_department_id) before it can be approved",
      data: result?.[0],
    }, 201);
  } catch (error: any) {
    if (error?.code === "23505") {
      return withCors(req, { success: false, error: "This employee already has an open transfer" }, 409);
    }
    console.error("Error creating transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// PUT update transfer (pending only); can set or change the destination
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Partial<TransferPayload> | null;
    const id = body?.id;

    if (!body || !id) {
      return withCors(req, { success: false, error: "Transfer id is required." }, 400);
    }

    const existing = await sql`
      SELECT t.*, e.company_id, e.department_id, e.designation_id, e.location_id
      FROM employee_transfers t JOIN employees e ON e.id = t.employee_id
      WHERE t.id = ${id}
    `;

    if (!existing[0] || !(await employeeInScope(auth.ctx, MANAGE, existing[0].employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending transfers can be updated.",
      }, 400);
    }

    let destination: Destination | null = null;
    if (namesDestination(body as Record<string, unknown>)) {
      const resolved = await resolveDestination(body as Record<string, unknown>, unitOf(existing[0]));
      if (!resolved.ok) return withCors(req, { success: false, error: resolved.error }, 400);
      destination = resolved.destination;
    }
    const setDestination = destination !== null;

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: "corehr.transfer.updated", targetType: "employee", targetId: existing[0].employee_id, details: { transfer_id: id, to: destination } },
      [sql`
        UPDATE employee_transfers
        SET
          from_department = COALESCE(${body.from_department}, from_department),
          to_department   = COALESCE(${body.to_department ?? destination?.departmentName}, to_department),
          from_position   = COALESCE(${body.from_position}, from_position),
          to_position     = COALESCE(${body.to_position ?? destination?.designationTitle}, to_position),
          from_location   = COALESCE(${body.from_location}, from_location),
          to_location     = COALESCE(${body.to_location ?? destination?.locationName}, to_location),
          to_company_id     = CASE WHEN ${setDestination} THEN ${destination?.companyId ?? null}::int ELSE to_company_id END,
          to_department_id  = CASE WHEN ${setDestination} THEN ${destination?.departmentId ?? null}::int ELSE to_department_id END,
          to_designation_id = CASE WHEN ${setDestination} THEN ${destination?.designationId ?? null}::int ELSE to_designation_id END,
          to_location_id    = CASE WHEN ${setDestination} THEN ${destination?.locationId ?? null}::int ELSE to_location_id END,
          effective_date  = COALESCE(${body.effective_date}, effective_date),
          reason          = COALESCE(${body.reason}, reason),
          updated_at      = NOW()
        WHERE id = ${id} AND status = 'pending'
        RETURNING *
      `]
    );

    if (!updated?.[0]) {
      return withCors(req, { success: false, error: "Only pending transfers can be updated." }, 409);
    }
    return withCors(req, {
      success: true,
      message: "Transfer updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// DELETE ?id=&reason=  Cancels a pending transfer; the record is kept
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;

    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "Transfer id is required." }, 400);
    }

    const existing = await sql`
      SELECT t.*, e.company_id, e.department_id, e.designation_id, e.location_id
      FROM employee_transfers t JOIN employees e ON e.id = t.employee_id
      WHERE t.id::text = ${id}
    `;

    if (!existing[0] || !coversEitherEnd(auth.ctx, MANAGE, unitOf(existing[0]), null)) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    if (existing[0].status !== "pending") {
      return withCors(req, {
        success: false,
        error: "Only pending transfers can be cancelled. Ask an approver to reject an approved transfer.",
      }, 400);
    }

    const [cancelled] = await runAudited(
      req,
      auth.ctx,
      { action: "corehr.transfer.cancelled", targetType: "employee", targetId: existing[0].employee_id, reason: readReason(req.nextUrl.searchParams.get("reason")), details: { transfer_id: Number(id) } },
      [sql`UPDATE employee_transfers SET status = 'cancelled', updated_at = NOW() WHERE id::text = ${id} AND status = 'pending' RETURNING id`]
    );
    if (!cancelled?.[0]) {
      return withCors(req, { success: false, error: "Only pending transfers can be cancelled." }, 409);
    }

    return withCors(req, {
      success: true,
      message: "Transfer cancelled",
    });
  } catch (error) {
    console.error("Error cancelling transfer:", error);
    return withCors(req, {
      success: false,
      error: "Failed to cancel transfer.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
