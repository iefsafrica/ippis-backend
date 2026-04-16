import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Deposit = {
  deposit_id: string;
  account_id: string;
  payer_id: string;
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
// ---------------- CREATE ----------------
//
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Deposit>;

    const {
      account_id,
      payer_id,
      amount,
      payment_method,
      category,
      reference,
      description,
      date
    } = body;

    if (!account_id || !payer_id || !amount || !date) {
      return withCors(req, {
        success: false,
        error: "account_id, payer_id, amount and date are required"
      }, 400);
    }

    if (Number(amount) <= 0) {
      return withCors(req, {
        success: false,
        error: "Amount must be greater than 0"
      }, 400);
    }

    // ✅ Validate account
    const account = await db`
      SELECT account_id FROM finance_accounts WHERE account_id = ${account_id}
    `;
    if (!account?.[0]) {
      return withCors(req, {
        success: false,
        error: "Account not found"
      }, 404);
    }

    // ✅ Validate payer
    const payer = await db`
      SELECT payer_id FROM finance_payers WHERE payer_id = ${payer_id}
    `;
    if (!payer?.[0]) {
      return withCors(req, {
        success: false,
        error: "Payer not found"
      }, 404);
    }

    const depositId = `DEP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO finance_deposits (
        deposit_id, account_id, payer_id, amount,
        payment_method, category, reference,
        description, status, date, created_at, updated_at
      )
      VALUES (
        ${depositId}, ${account_id}, ${payer_id}, ${amount},
        ${payment_method ?? null}, ${category ?? null}, ${reference ?? depositId},
        ${description ?? null}, 'Completed', ${date}, NOW(), NOW()
      )
      RETURNING *
    `;

    // ✅ Update account balance
    await db`
      UPDATE finance_accounts
      SET balance = balance + ${amount}, updated_at = NOW()
      WHERE account_id = ${account_id}
    `;

    // ✅ Update payer
    await db`
      UPDATE finance_payers
      SET last_payment = ${amount},
          last_payment_date = ${date},
          updated_at = NOW()
      WHERE payer_id = ${payer_id}
    `;

    return withCors(req, {
      success: true,
      message: "Deposit created successfully",
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to create deposit"
    }, 500);
  }
}

//
// ---------------- READ ----------------
//
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const depositId = searchParams.get("deposit_id");

    // ✅ SINGLE
    if (depositId) {
      const single = await db`
        SELECT 
          d.*,
          COALESCE(a.account_name, 'N/A') as account_name,
          COALESCE(p.payer_name, 'N/A') as payer_name
        FROM finance_deposits d
        LEFT JOIN finance_accounts a ON d.account_id = a.account_id
        LEFT JOIN finance_payers p ON d.payer_id = p.payer_id
        WHERE d.deposit_id = ${depositId}
      `;

      if (!single?.[0]) {
        return withCors(req, {
          success: false,
          error: "Deposit not found"
        }, 404);
      }

      return withCors(req, {
        success: true,
        data: single[0]
      });
    }

    // ✅ LIST
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const result = await db`
      SELECT 
        d.*,
        COALESCE(a.account_name, 'N/A') as account_name,
        COALESCE(p.payer_name, 'N/A') as payer_name
      FROM finance_deposits d
      LEFT JOIN finance_accounts a ON d.account_id = a.account_id
      LEFT JOIN finance_payers p ON d.payer_id = p.payer_id
      ORDER BY d.date DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`SELECT COUNT(*) FROM finance_deposits`;

    return withCors(req, {
      success: true,
      data: {
        deposits: result,
        pagination: {
          total: Number((count as any)?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error: any) {
    console.error("GET ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to fetch deposits"
    }, 500);
  }
}

//
// ---------------- UPDATE ----------------
//
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Deposit>;

    if (!body.deposit_id) {
      return withCors(req, {
        success: false,
        error: "deposit_id is required"
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_deposits WHERE deposit_id = ${body.deposit_id}
    `;

    const d = existing?.[0];

    if (!d) {
      return withCors(req, {
        success: false,
        error: "Deposit not found"
      }, 404);
    }

    const oldAmount = Number(d.amount);
    const newAmount = Number(body.amount ?? oldAmount);
    const diff = newAmount - oldAmount;

    const updated = await db`
      UPDATE finance_deposits SET
        account_id = ${body.account_id ?? d.account_id},
        payer_id = ${body.payer_id ?? d.payer_id},
        amount = ${newAmount},
        payment_method = ${body.payment_method ?? d.payment_method},
        category = ${body.category ?? d.category},
        reference = ${body.reference ?? d.reference},
        description = ${body.description ?? d.description},
        date = ${body.date ?? d.date},
        updated_at = NOW()
      WHERE deposit_id = ${body.deposit_id}
      RETURNING *
    `;

    // ✅ Adjust balance
    if (diff !== 0) {
      await db`
        UPDATE finance_accounts
        SET balance = balance + ${diff}, updated_at = NOW()
        WHERE account_id = ${d.account_id}
      `;
    }

    return withCors(req, {
      success: true,
      message: "Deposit updated successfully",
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to update deposit"
    }, 500);
  }
}

//
// ---------------- DELETE ----------------
//
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const depositId = searchParams.get("deposit_id");

    if (!depositId) {
      return withCors(req, {
        success: false,
        error: "deposit_id required"
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_deposits WHERE deposit_id = ${depositId}
    `;

    const d = existing?.[0];

    if (!d) {
      return withCors(req, {
        success: false,
        error: "Deposit not found"
      }, 404);
    }

    // ✅ Reverse balance
    await db`
      UPDATE finance_accounts
      SET balance = balance - ${d.amount}, updated_at = NOW()
      WHERE account_id = ${d.account_id}
    `;

    await db`
      DELETE FROM finance_deposits WHERE deposit_id = ${depositId}
    `;

    return withCors(req, {
      success: true,
      message: "Deposit deleted successfully"
    });

  } catch (error: any) {
    console.error("DELETE ERROR:", error);

    return withCors(req, {
      success: false,
      error: error.message || "Failed to delete deposit"
    }, 500);
  }
}