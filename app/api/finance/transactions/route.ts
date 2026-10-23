import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, canSee, parentOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Transaction = {
  transaction_id: string;
  account_id: string;
  transaction_type: 'Income' | 'Expense' | 'Transfer';
  amount: number;
  payment_method?: string;
  category?: string;
  reference_id?: string;
  description?: string;
  status?: string;
  transaction_date: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ----------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<Transaction>;

    const {
      account_id,
      transaction_type,
      amount,
      payment_method,
      category,
      reference_id,
      description,
      transaction_date,
      status
    } = body;

    // Validation
    if (!account_id || !transaction_type || !amount || !transaction_date) {
      return withCors(req, {
        success: false,
        error: "Missing required fields (account_id, transaction_type, amount, transaction_date)"
      }, 400);
    }

    if (!['Income', 'Expense', 'Transfer'].includes(transaction_type)) {
      return withCors(req, {
        success: false,
        error: "Invalid transaction_type. Must be Income, Expense, or Transfer"
      }, 400);
    }

    if (Number(amount) <= 0) {
      return withCors(req, {
        success: false,
        error: "Amount must be greater than 0"
      }, 400);
    }

    // ✅ Verify Account Exists
    const account = await db`SELECT account_id, balance FROM finance_accounts WHERE account_id = ${account_id}`;
    // A transaction belongs to its account's MDA: the account must be inside the caller's scope
    if (!account?.[0] || !canChange(auth.ctx, "finance.records.manage", await parentOf("account", account_id))) {
      return withCors(req, { success: false, error: "Account not found or outside your organisational scope" }, 404);
    }

    const transactionId = `TXN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    // ✅ DB Transaction: Insert Transaction and Update Balance
    const result = await db`
      INSERT INTO finance_transactions (
        transaction_id, account_id, transaction_type, amount,
        payment_method, category, reference_id,
        description, status, transaction_date,
        created_at, updated_at
      )
      VALUES (
        ${transactionId}, ${account_id}, ${transaction_type}, ${amount},
        ${payment_method ?? null}, ${category ?? null}, ${reference_id ?? null},
        ${description ?? null}, ${status ?? 'Completed'}, ${transaction_date},
        NOW(), NOW()
      )
      RETURNING *
    `;

    // ✅ Auto Adjust Balance
    let balanceUpdate = 0;
    if (transaction_type === 'Income') balanceUpdate = Number(amount);
    else if (transaction_type === 'Expense') balanceUpdate = -Number(amount);
    
    if (balanceUpdate !== 0) {
      await db`
        UPDATE finance_accounts 
        SET balance = balance + ${balanceUpdate}, updated_at = NOW() 
        WHERE account_id = ${account_id}
      `;
    }

    await runAudited(req, auth.ctx, { action: "finance.transaction.created", targetType: "finance.transaction", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Transaction created successfully",
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE TRANSACTION ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to create transaction"
    }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const transactionId = searchParams.get("transaction_id");
    // Only the transactions of accounts in the caller's MDA or department
    const sc = moduleScope(auth.ctx, "finance.records.view");

    // SINGLE
    if (transactionId) {
      const single = await db`
        SELECT 
          t.*, 
          a.account_name,
          COALESCE(p.payee_name, pyr.payer_name, 'N/A') as entity_name
        FROM finance_transactions t
        JOIN finance_accounts a ON t.account_id = a.account_id
        LEFT JOIN finance_payees p ON t.reference_id = p.payee_id AND t.transaction_type = 'Expense'
        LEFT JOIN finance_payers pyr ON t.reference_id = pyr.payer_id AND t.transaction_type = 'Income'
        WHERE t.transaction_id = ${transactionId}
          AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
      `;
      if (!single?.[0]) {
        return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
      }
      return withCors(req, { success: true, data: single?.[0] ?? null });
    }

    // LIST with Search & Filters
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const search = searchParams.get("search");
    const type = searchParams.get("type");
    const accountId = searchParams.get("account_id");
    const category = searchParams.get("category");

    // One parameterised query (the driver does not support nested query fragments)
    const where = `WHERE ($1::text IS NULL OR t.description ILIKE $1 OR t.category ILIKE $1 OR p.payee_name ILIKE $1 OR pyr.payer_name ILIKE $1)
        AND ($2::text IS NULL OR t.transaction_type = $2)
        AND ($3::text IS NULL OR t.account_id = $3)
        AND ($4::text IS NULL OR t.category = $4)
        AND ($5::boolean OR a.company_id = ANY($6::int[]) OR a.department_id = ANY($7::int[]))`;
    const joins = `FROM finance_transactions t
      JOIN finance_accounts a ON t.account_id = a.account_id
      LEFT JOIN finance_payees p ON t.reference_id = p.payee_id AND t.transaction_type = 'Expense'
      LEFT JOIN finance_payers pyr ON t.reference_id = pyr.payer_id AND t.transaction_type = 'Income'`;
    const params = [search ? `%${search}%` : null, type, accountId, category, sc.all, sc.companyIds, sc.departmentIds];

    const transactions = await db.query(
      `SELECT t.*, a.account_name, COALESCE(p.payee_name, pyr.payer_name, 'N/A') as entity_name
       ${joins} ${where}
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT $8 OFFSET $9`,
      [...params, limit, offset]
    );

    const totals = await db.query(`SELECT COUNT(*) ${joins} ${where}`, params);

    return withCors(req, {
      success: true,
      data: {
        transactions,
        pagination: {
          total: Number(totals?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error: any) {
    console.error("GET TRANSACTIONS ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to fetch transactions"
    }, 500);
  }
}

// ---------------- UPDATE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as Partial<Transaction> & { transaction_id: string };

    if (!body.transaction_id) {
      return withCors(req, { success: false, error: "transaction_id is required" }, 400);
    }

    const existing = await db`SELECT * FROM finance_transactions WHERE transaction_id = ${body.transaction_id}`;
    if (!existing?.[0]) {
      return withCors(req, { success: false, error: "Transaction not found" }, 404);
    }

    const t = existing[0];
    if (!canChange(auth.ctx, "finance.records.manage", await parentOf("account", t.account_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }
    if (body.account_id && body.account_id !== t.account_id && !canChange(auth.ctx, "finance.records.manage", await parentOf("account", body.account_id))) {
      return withCors(req, { success: false, error: "Account not found or outside your organisational scope" }, 404);
    }

    // Calculate Balance Reversal and New Application
    // Reverse old
    let reverse = 0;
    if (t.transaction_type === 'Income') reverse = -Number(t.amount);
    else if (t.transaction_type === 'Expense') reverse = Number(t.amount);

    // Apply new
    const newAmount = body.amount ?? Number(t.amount);
    const newType = body.transaction_type ?? t.transaction_type;
    let application = 0;
    if (newType === 'Income') application = Number(newAmount);
    else if (newType === 'Expense') application = -Number(newAmount);

    const netEffect = reverse + application;

    const updated = await db`
      UPDATE finance_transactions SET
        account_id = ${body.account_id ?? t.account_id},
        transaction_type = ${body.transaction_type ?? t.transaction_type},
        amount = ${body.amount ?? t.amount},
        payment_method = ${body.payment_method ?? t.payment_method},
        category = ${body.category ?? t.category},
        reference_id = ${body.reference_id ?? t.reference_id},
        description = ${body.description ?? t.description},
        status = ${body.status ?? t.status},
        transaction_date = ${body.transaction_date ?? t.transaction_date},
        updated_at = NOW()
      WHERE transaction_id = ${body.transaction_id}
      RETURNING *
    `;

    // Apply net balance change if any
    if (netEffect !== 0) {
      await db`
        UPDATE finance_accounts 
        SET balance = balance + ${netEffect}, updated_at = NOW() 
        WHERE account_id = ${t.account_id}
      `;
    }

    await runAudited(req, auth.ctx, { action: "finance.transaction.updated", targetType: "finance.transaction", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Transaction updated successfully",
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE TRANSACTION ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to update transaction"
    }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const transactionId = searchParams.get("transaction_id");

    if (!transactionId) {
      return withCors(req, { success: false, error: "transaction_id required" }, 400);
    }

    const existing = await db`SELECT * FROM finance_transactions WHERE transaction_id = ${transactionId}`;
    if (!existing?.[0]) {
      return withCors(req, { success: false, error: "Transaction not found" }, 404);
    }

    const t = existing[0];
    if (!canChange(auth.ctx, "finance.records.manage", await parentOf("account", t.account_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    // Reverse Balance Impact
    let reversal = 0;
    if (t.transaction_type === 'Income') reversal = -Number(t.amount);
    else if (t.transaction_type === 'Expense') reversal = Number(t.amount);

    if (reversal !== 0) {
      await db`
        UPDATE finance_accounts 
        SET balance = balance + ${reversal}, updated_at = NOW() 
        WHERE account_id = ${t.account_id}
      `;
    }

    await db`DELETE FROM finance_transactions WHERE transaction_id = ${transactionId}`;

    await runAudited(req, auth.ctx, { action: "finance.transaction.deleted", targetType: "finance.transaction", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Transaction deleted successfully"
    });

  } catch (error: any) {
    console.error("DELETE TRANSACTION ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to delete transaction"
    }, 500);
  }
}
