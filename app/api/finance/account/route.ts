import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ----------------- TYPES -----------------
type FinanceAccount = {
  id?: number;
  account_id: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  account_type: string;
  currency?: string;
  balance?: number;
  opening_date?: string;
  status?: string;
  branch_code?: string;
  swift_code?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
};

// ----------------- CORS -----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ----------------- CREATE -----------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<FinanceAccount>;

    const {
      account_name,
      account_number,
      bank_name,
      account_type,
      currency,
      balance,
      opening_date,
      status,
      branch_code,
      swift_code,
      description
    } = body;

    if (!account_name || !account_number || !bank_name || !account_type) {
      return withCors(req, {
        success: false,
        error: "Required fields missing"
      }, 400);
    }

    // The account belongs to an MDA inside the caller's scope
    const placed = await placementFor(auth.ctx, "finance.records.manage", body as Record<string, unknown>);
    if (!placed.ok) return withCors(req, { success: false, error: placed.error }, placed.status);

    const accountId = `ACC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO finance_accounts (
        account_id, account_name, account_number, bank_name,
        account_type, currency, balance, opening_date,
        status, branch_code, swift_code, description,
        company_id, department_id, created_at, updated_at
      )
      VALUES (
        ${accountId}, ${account_name}, ${account_number}, ${bank_name},
        ${account_type}, ${currency ?? "NGN"}, ${balance ?? 0}, ${opening_date ?? null},
        ${status ?? "Active"}, ${branch_code ?? null}, ${swift_code ?? null}, ${description ?? null},
        ${placed.placement.companyId}, ${placed.placement.departmentId}, NOW(), NOW()
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "finance.account.created", targetType: "finance.account", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Account created successfully",
      data: result[0]
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to create account",
      details: String(error)
    }, 500);
  }
}

// ----------------- READ -----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    // Only the accounts of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "finance.records.view");
    const result = await db`
      SELECT * FROM finance_accounts a
      WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`SELECT COUNT(*) FROM finance_accounts a WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))`;

    return withCors(req, {
      success: true,
      data: {
        accounts: result,
        pagination: {
          total: Number((count as any)[0].count),
          page,
          limit
        }
      }
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to fetch accounts",
      details: String(error)
    }, 500);
  }
}

// ----------------- UPDATE -----------------
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<FinanceAccount>;

    if (!body.account_id) {
      return withCors(req, {
        success: false,
        error: "account_id is required"
      }, 400);
    }

    // Fetch existing
    const existingRes = await db`
      SELECT * FROM finance_accounts WHERE account_id = ${body.account_id}
    `;

    const existing = existingRes[0]!;

    if (!canChange(auth.ctx, "finance.records.manage", existing)) {
      return withCors(req, {
        success: false,
        error: OUT_OF_SCOPE
      }, 404);
    }
    // Moving the account to another MDA needs authority over the destination
    const placed = await placementFor(auth.ctx, "finance.records.manage", body as Record<string, unknown>, placementOf(existing));
    if (!placed.ok) return withCors(req, { success: false, error: placed.error }, placed.status);

    const result = await db`
      UPDATE finance_accounts
      SET
        account_name = ${body.account_name ?? existing.account_name},
        account_number = ${body.account_number ?? existing.account_number},
        bank_name = ${body.bank_name ?? existing.bank_name},
        account_type = ${body.account_type ?? existing.account_type},
        currency = ${body.currency ?? existing.currency},
        balance = ${body.balance ?? existing.balance},
        opening_date = ${body.opening_date ?? existing.opening_date},
        status = ${body.status ?? existing.status},
        branch_code = ${body.branch_code ?? existing.branch_code},
        swift_code = ${body.swift_code ?? existing.swift_code},
        description = ${body.description ?? existing.description},
        company_id = ${placed.placement.companyId},
        department_id = ${placed.placement.departmentId},
        updated_at = NOW()
      WHERE account_id = ${body.account_id}
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "finance.account.updated", targetType: "finance.account", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Account updated successfully",
      data: result[0]
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to update account",
      details: String(error)
    }, 500);
  }
}

// ----------------- DELETE -----------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("account_id");

    if (!accountId) {
      return withCors(req, {
        success: false,
        error: "account_id is required"
      }, 400);
    }

    const [existing] = await db`SELECT company_id, department_id FROM finance_accounts WHERE account_id = ${accountId}`;
    if (!canChange(auth.ctx, "finance.records.manage", existing)) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    await db`
      DELETE FROM finance_accounts WHERE account_id = ${accountId}
    `;

    await runAudited(req, auth.ctx, { action: "finance.account.deleted", targetType: "finance.account", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Account deleted successfully"
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: "Failed to delete account",
      details: String(error)
    }, 500);
  }
}