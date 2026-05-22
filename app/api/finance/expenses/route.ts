import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Expense = {
  expense_id: string;
  account_id: string;
  payee_id: string;
  amount: number;
  payment_method?: string;
  category?: string;
  reference?: string;
  description?: string;
  status?: string;
  date: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

//
// ---------------- CREATE EXPENSE ----------------
//
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Expense>;

    const {
      account_id,
      payee_id,
      amount,
      payment_method,
      category,
      reference,
      description,
      date,
    } = body;

    if (!account_id || !payee_id || !amount || !date) {
      return withCors(req, {
        success: false,
        error: "account_id, payee_id, amount and date are required",
      }, 400);
    }

    if (Number(amount) <= 0) {
      return withCors(req, {
        success: false,
        error: "Amount must be greater than 0",
      }, 400);
    }

    // validate account
    const account = await db`
      SELECT account_id FROM finance_accounts WHERE account_id = ${account_id}
    `;
    if (!account?.[0]) {
      return withCors(req, { success: false, error: "Account not found" }, 404);
    }

    // validate payee
    const payee = await db`
      SELECT payee_id FROM finance_payees WHERE payee_id = ${payee_id}
    `;
    if (!payee?.[0]) {
      return withCors(req, { success: false, error: "Payee not found" }, 404);
    }

    const expenseId = `EXP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO finance_expenses (
        expense_id, account_id, payee_id, amount,
        payment_method, category, reference,
        description, status, date, created_at, updated_at
      )
      VALUES (
        ${expenseId}, ${account_id}, ${payee_id}, ${amount},
        ${payment_method ?? null}, ${category ?? null},
        ${reference ?? expenseId},
        ${description ?? null}, 'Pending', ${date},
        NOW(), NOW()
      )
      RETURNING *
    `;

    // OPTIONAL: deduct balance (important difference from deposits)
    await db`
      UPDATE finance_accounts
      SET balance = balance - ${amount}, updated_at = NOW()
      WHERE account_id = ${account_id}
    `;

    return withCors(req, {
      success: true,
      message: "Expense created successfully",
      data: result?.[0] ?? null,
    });

  } catch (error: any) {
    console.error("CREATE EXPENSE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to create expense",
    }, 500);
  }
}

//
// ---------------- READ EXPENSES ----------------
//
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const expenseId = searchParams.get("expense_id");

    // SINGLE
    if (expenseId) {
      const single = await db`
        SELECT 
          e.*,
          COALESCE(a.account_name, 'N/A') as account_name,
          COALESCE(p.payee_name, 'N/A') as payee_name
        FROM finance_expenses e
        LEFT JOIN finance_accounts a ON e.account_id = a.account_id
        LEFT JOIN finance_payees p ON e.payee_id = p.payee_id
        WHERE e.expense_id = ${expenseId}
      `;

      if (!single?.[0]) {
        return withCors(req, { success: false, error: "Expense not found" }, 404);
      }

      return withCors(req, { success: true, data: single[0] });
    }

    // LIST
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 10);
    const offset = (page - 1) * limit;

    const result = await db`
      SELECT 
        e.*,
        COALESCE(a.account_name, 'N/A') as account_name,
        COALESCE(p.payee_name, 'N/A') as payee_name
      FROM finance_expenses e
      LEFT JOIN finance_accounts a ON e.account_id = a.account_id
      LEFT JOIN finance_payees p ON e.payee_id = p.payee_id
      ORDER BY e.date DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`SELECT COUNT(*) FROM finance_expenses`;

    return withCors(req, {
      success: true,
      data: {
        expenses: result,
        pagination: {
          total: Number(count?.[0]?.count ?? 0),
          page,
          limit,
        },
      },
    });

  } catch (error: any) {
    console.error("GET EXPENSE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to fetch expenses",
    }, 500);
  }
}

//
// ---------------- UPDATE ----------------
//
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Expense>;

    if (!body.expense_id) {
      return withCors(req, {
        success: false,
        error: "expense_id is required",
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_expenses WHERE expense_id = ${body.expense_id}
    `;

    const e = existing?.[0];

    if (!e) {
      return withCors(req, { success: false, error: "Expense not found" }, 404);
    }

    const oldAmount = Number(e.amount);
    const newAmount = Number(body.amount ?? oldAmount);
    const diff = newAmount - oldAmount;

    const updated = await db`
      UPDATE finance_expenses SET
        account_id = ${body.account_id ?? e.account_id},
        payee_id = ${body.payee_id ?? e.payee_id},
        amount = ${newAmount},
        payment_method = ${body.payment_method ?? e.payment_method},
        category = ${body.category ?? e.category},
        reference = ${body.reference ?? e.reference},
        description = ${body.description ?? e.description},
        date = ${body.date ?? e.date},
        updated_at = NOW()
      WHERE expense_id = ${body.expense_id}
      RETURNING *
    `;

    // adjust balance
    if (diff !== 0) {
      await db`
        UPDATE finance_accounts
        SET balance = balance - ${diff}, updated_at = NOW()
        WHERE account_id = ${e.account_id}
      `;
    }

    return withCors(req, {
      success: true,
      message: "Expense updated successfully",
      data: updated?.[0] ?? null,
    });

  } catch (error: any) {
    console.error("UPDATE EXPENSE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to update expense",
    }, 500);
  }
}

//
// ---------------- DELETE ----------------
//
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const expenseId = searchParams.get("expense_id");

    if (!expenseId) {
      return withCors(req, {
        success: false,
        error: "expense_id required",
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_expenses WHERE expense_id = ${expenseId}
    `;

    const e = existing?.[0];

    if (!e) {
      return withCors(req, { success: false, error: "Expense not found" }, 404);
    }

    // reverse balance
    await db`
      UPDATE finance_accounts
      SET balance = balance + ${e.amount}, updated_at = NOW()
      WHERE account_id = ${e.account_id}
    `;

    await db`
      DELETE FROM finance_expenses WHERE expense_id = ${expenseId}
    `;

    return withCors(req, {
      success: true,
      message: "Expense deleted successfully",
    });

  } catch (error: any) {
    console.error("DELETE EXPENSE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to delete expense",
    }, 500);
  }
}