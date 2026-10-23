import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, canSee, OUT_OF_SCOPE } from "@/lib/module-scope";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// ---------------------------
// Type definition for Invoice
// ---------------------------
type InvoicePayload = {
  id?: number;
  client_id?: number;
  project_id?: number;
  issue_date?: string;
  due_date?: string;
  status?: string;
  total?: number;
};

// ---------------------------
// Helper: check if table exists
// ---------------------------
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${tableName}
      )
    `;
    return result?.[0]?.exists ?? false;
  } catch {
    return false;
  }
}

// ---------------------------
// OPTIONS (CORS Preflight)
// ---------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------------------
// CREATE (POST) endpoint
// Auto-generates invoice_number like INV-2023-001
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as InvoicePayload;

    if (!body.client_id || !body.project_id) {
      return withCors(req, { success: false, error: "Missing required fields" }, 400);
    }

    // An invoice belongs to its project's MDA: the project must be inside the
    // caller's scope, and the client visible to them
    const client = await sql`SELECT id, company_id, department_id FROM clients WHERE id = ${body.client_id}`;
    if (!canSee(auth.ctx, "finance.records.manage", client[0])) {
      return withCors(req, { success: false, error: "Client not found or outside your organisational scope" }, 404);
    }

    const project = await sql`SELECT id, company_id, department_id FROM projects WHERE id = ${body.project_id}`;
    if (!canChange(auth.ctx, "finance.records.manage", project[0])) {
      return withCors(req, { success: false, error: "Project not found or outside your organisational scope" }, 404);
    }

    // Auto-generate invoice_number like INV-2023-001
    const year = new Date().getFullYear();
    const lastInvoice = await sql`
      SELECT invoice_number FROM invoices WHERE invoice_number LIKE ${`INV-${year}-%`} ORDER BY id DESC LIMIT 1
    `;
    let newInvoiceNumber = `INV-${year}-001`;
    if (lastInvoice.length && lastInvoice[0]?.invoice_number) {
      const lastNumber = parseInt(lastInvoice[0].invoice_number.split("-")[2], 10);
      const nextNumber = lastNumber + 1;
      newInvoiceNumber = `INV-${year}-${nextNumber.toString().padStart(3, "0")}`;
    }

    const result = await sql`
      INSERT INTO invoices (
        invoice_number,
        client_id,
        project_id,
        issue_date,
        due_date,
        status,
        total
      )
      VALUES (
        ${newInvoiceNumber},
        ${body.client_id},
        ${body.project_id},
        ${body.issue_date},
        ${body.due_date},
        ${body.status || "Unpaid"},
        ${body.total || 0}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "finance.invoice.created", targetType: "finance.invoice", details: {} }, []);

    return withCors(req, { success: true, data: result?.[0] ?? null });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "POST failed" }, 500);
  }
}

// ---------------------------
// READ (GET) endpoint
// Supports pagination & optional id filter
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.view");
    if (!auth.ok) return auth.response;

    const exists = await tableExists("invoices");
    if (!exists) return withCors(req, { success: false, error: "Invoices table does not exist" }, 404);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;
    const idFilter = searchParams.get("id");
    // Only the invoices of projects in the caller's MDA or department
    const sc = moduleScope(auth.ctx, "finance.records.view");

    let rows;
    if (idFilter) {
      rows = await sql`
        SELECT i.*, c.name AS client_name, p.name AS project_name
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        JOIN projects p ON i.project_id = p.id
        WHERE i.id = ${idFilter}
          AND (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))
      `;
      if (!rows.length) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    } else {
      rows = await sql`
        SELECT i.*, c.name AS client_name, p.name AS project_name
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        JOIN projects p ON i.project_id = p.id
        WHERE (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const countResult = await sql`SELECT COUNT(*) AS total FROM invoices i JOIN projects p ON p.id = i.project_id WHERE (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))`;
    const total = Number(countResult?.[0]?.total ?? 0);

    return withCors(req, {
      success: true,
      data: {
        invoices: rows,
        pagination: idFilter ? undefined : { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "GET failed" }, 500);
  }
}

// ---------------------------
// UPDATE (PUT) endpoint
// ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as InvoicePayload;
    if (!body.id) return withCors(req, { success: false, error: "ID is required" }, 400);
    // The invoice's project, and any project it moves to, must be inside the caller's scope
    const [current] = await sql`SELECT p.company_id, p.department_id FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = ${body.id}`;
    if (!canChange(auth.ctx, "finance.records.manage", current)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    if (body.project_id) {
      const [project] = await sql`SELECT company_id, department_id FROM projects WHERE id = ${body.project_id}`;
      if (!canChange(auth.ctx, "finance.records.manage", project)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      UPDATE invoices SET
        client_id = COALESCE(${body.client_id}, client_id),
        project_id = COALESCE(${body.project_id}, project_id),
        issue_date = COALESCE(${body.issue_date}, issue_date),
        due_date = COALESCE(${body.due_date}, due_date),
        status = COALESCE(${body.status}, status),
        total = COALESCE(${body.total}, total)
      WHERE id = ${body.id}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404);
    await runAudited(req, auth.ctx, { action: "finance.invoice.updated", targetType: "finance.invoice", details: {} }, []);

    return withCors(req, { success: true, data: result[0] });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "PUT failed" }, 500);
  }
}

// ---------------------------
// DELETE endpoint
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return withCors(req, { success: false, error: "ID required" }, 400);

    const [current] = await sql`SELECT p.company_id, p.department_id FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = ${id}`;
    if (!canChange(auth.ctx, "finance.records.manage", current)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    const result = await sql`DELETE FROM invoices WHERE id = ${id} RETURNING *`;
    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404);

    await runAudited(req, auth.ctx, { action: "finance.invoice.deleted", targetType: "finance.invoice", details: {} }, []);

    return withCors(req, { success: true, message: "Deleted successfully" });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "DELETE failed" }, 500);
  }
}