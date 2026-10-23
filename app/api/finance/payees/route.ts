import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Payee = {
  payee_id: string;
  payee_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  account_number: string;
  bank_name: string;
  tax_id?: string;
  category: string;
  status?: string;
  notes?: string;
  last_payment?: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

//
// ---------------- CREATE ----------------
//
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<Payee>;

    const {
      payee_name,
      contact_person,
      email,
      phone,
      address,
      account_number,
      bank_name,
      tax_id,
      category,
      status,
      notes
    } = body;

    if (
      !payee_name ||
      !contact_person ||
      !email ||
      !phone ||
      !address ||
      !account_number ||
      !bank_name ||
      !category
    ) {
      return withCors(req, {
        success: false,
        error: "Missing required fields"
      }, 400);
    }

    // The payee belongs to an MDA inside the caller's scope
    const placed = await placementFor(auth.ctx, "finance.records.manage", body as Record<string, unknown>);
    if (!placed.ok) return withCors(req, { success: false, error: placed.error }, placed.status);

    const payeeId = `PAY-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO finance_payees (
        payee_id, payee_name, contact_person, email, phone,
        address, account_number, bank_name, tax_id,
        category, status, notes, company_id, department_id, created_at, updated_at
      )
      VALUES (
        ${payeeId}, ${payee_name}, ${contact_person}, ${email}, ${phone},
        ${address}, ${account_number}, ${bank_name}, ${tax_id ?? null},
        ${category}, ${status ?? "Active"}, ${notes ?? null}, ${placed.placement.companyId}, ${placed.placement.departmentId}, NOW(), NOW()
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "finance.payee.created", targetType: "finance.payee", details: {} }, []);

    return withCors(req, {
      success: true,
      data: result?.[0] ?? null
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- GET ----------------
//
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const sortBy = searchParams.get("sortBy") || "created_at";
    const order = searchParams.get("order") === "asc";

    const search = searchParams.get("search");

    // ✅ whitelist
    const validSortFields = {
      payee_name: "payee_name",
      contact_person: "contact_person",
      email: "email",
      phone: "phone",
      category: "category",
      status: "status",
      last_payment: "last_payment",
      created_at: "created_at"
    };

    const sortField =
      validSortFields[sortBy as keyof typeof validSortFields] ||
      "created_at";

    // Only the payees of the caller's MDA or department. One parameterised
    // query: the sort column comes from the whitelist above, never the request.
    const sc = moduleScope(auth.ctx, "finance.records.view");
    const where = `WHERE ($1::text IS NULL OR payee_name ILIKE $1)
      AND ($2::boolean OR company_id = ANY($3::int[]) OR department_id = ANY($4::int[]))`;
    const params = [search ? `%${search}%` : null, sc.all, sc.companyIds, sc.departmentIds];
    const result = await db.query(
      `SELECT * FROM finance_payees ${where} ORDER BY ${sortField} ${order ? "ASC" : "DESC"} NULLS LAST, created_at DESC LIMIT $5 OFFSET $6`,
      [...params, limit, offset]
    );
    const count = await db.query(`SELECT COUNT(*) FROM finance_payees ${where}`, params);

    return withCors(req, {
      success: true,
      data: {
        payees: result,
        pagination: {
          total: Number((count as any)?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- UPDATE ----------------
//
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<Payee>;

    if (!body.payee_id) {
      return withCors(req, {
        success: false,
        error: "payee_id is required"
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_payees WHERE payee_id = ${body.payee_id}
    `;

    const e = existing?.[0]!;

    if (!canChange(auth.ctx, "finance.records.manage", e)) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }
    const placed = await placementFor(auth.ctx, "finance.records.manage", body as Record<string, unknown>, placementOf(e));
    if (!placed.ok) return withCors(req, { success: false, error: placed.error }, placed.status);

    const updated = await db`
      UPDATE finance_payees SET
        payee_name = ${body.payee_name ?? e.payee_name},
        contact_person = ${body.contact_person ?? e.contact_person},
        email = ${body.email ?? e.email},
        phone = ${body.phone ?? e.phone},
        address = ${body.address ?? e.address},
        account_number = ${body.account_number ?? e.account_number},
        bank_name = ${body.bank_name ?? e.bank_name},
        tax_id = ${body.tax_id ?? e.tax_id},
        category = ${body.category ?? e.category},
        status = ${body.status ?? e.status},
        notes = ${body.notes ?? e.notes},
        company_id = ${placed.placement.companyId},
        department_id = ${placed.placement.departmentId},
        updated_at = NOW()
      WHERE payee_id = ${body.payee_id}
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "finance.payee.updated", targetType: "finance.payee", details: {} }, []);

    return withCors(req, {
      success: true,
      data: updated?.[0] ?? null
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- DELETE ----------------
//
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const payeeId = searchParams.get("payee_id");

    if (!payeeId) {
      return withCors(req, {
        success: false,
        error: "payee_id required"
      }, 400);
    }

    const [existing] = await db`SELECT company_id, department_id FROM finance_payees WHERE payee_id = ${payeeId}`;
    if (!canChange(auth.ctx, "finance.records.manage", existing)) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    await db`
      DELETE FROM finance_payees WHERE payee_id = ${payeeId}
    `;

    await runAudited(req, auth.ctx, { action: "finance.payee.deleted", targetType: "finance.payee", details: {} }, []);

    return withCors(req, {
      success: true
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}