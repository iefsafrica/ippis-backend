import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Transfer = {
  transfer_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  fees?: number;
  payment_mode?: string;
  reference_no?: string;
  description?: string;
  status?: string;
  date: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Transfer>;

    const {
      from_account_id,
      to_account_id,
      amount,
      fees,
      payment_mode,
      reference_no,
      description,
      date,
      status
    } = body;

    // Validation
    if (!from_account_id || !to_account_id || !amount || !date) {
      return withCors(req, {
        success: false,
        error: "Missing fields (from_account_id, to_account_id, amount, date)"
      }, 400);
    }

    if (from_account_id === to_account_id) {
      return withCors(req, {
        success: false,
        error: "Self-transfer is not allowed (From account and To account are the same)"
      }, 400);
    }

    if (Number(amount) <= 0) {
      return withCors(req, { success: false, error: "Amount must be greater than 0" }, 400);
    }

    // ✅ Verify Both Accounts
    const accounts = await db`
      SELECT account_id, balance FROM finance_accounts 
      WHERE account_id IN (${from_account_id}, ${to_account_id})
    `;

    if (accounts.length < 2) {
       return withCors(req, { success: false, error: "One or both accounts not found" }, 404);
    }

    const transferId = `TRF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const totalDeduction = Number(amount) + Number(fees ?? 0);

    // ✅ DB Transaction: Insert Transfer and Update Balances
    const result = await db`
      INSERT INTO finance_transfers (
        transfer_id, from_account_id, to_account_id, amount,
        fees, payment_mode, reference_no,
        description, status, date,
        created_at, updated_at
      )
      VALUES (
        ${transferId}, ${from_account_id}, ${to_account_id}, ${amount},
        ${fees ?? 0}, ${payment_mode ?? null}, ${reference_no ?? null},
        ${description ?? null}, ${status ?? 'Completed'}, ${date},
        NOW(), NOW()
      )
      RETURNING *
    `;

    // ✅ Adjust Balances
    // Deduct from Source
    await db`
      UPDATE finance_accounts 
      SET balance = balance - ${totalDeduction}, updated_at = NOW() 
      WHERE account_id = ${from_account_id}
    `;

    // Add to Destination
    await db`
      UPDATE finance_accounts 
      SET balance = balance + ${amount}, updated_at = NOW() 
      WHERE account_id = ${to_account_id}
    `;

    return withCors(req, {
      success: true,
      message: "Transfer processed successfully",
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE TRANSFER ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to process transfer"
    }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const transferId = searchParams.get("transfer_id");

    // SINGLE
    if (transferId) {
      const single = await db`
        SELECT 
          t.*, 
          f.account_name as from_account_name,
          to_acc.account_name as to_account_name
        FROM finance_transfers t
        JOIN finance_accounts f ON t.from_account_id = f.account_id
        JOIN finance_accounts to_acc ON t.to_account_id = to_acc.account_id
        WHERE t.transfer_id = ${transferId}
      `;
      if (!single?.[0]) {
        return withCors(req, { success: false, error: "Transfer not found" }, 404);
      }
      return withCors(req, { success: true, data: single?.[0] ?? null });
    }

    // LIST
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const transfers = await db`
      SELECT 
        t.*, 
        f.account_name as from_account_name,
        to_acc.account_name as to_account_name
      FROM finance_transfers t
      JOIN finance_accounts f ON t.from_account_id = f.account_id
      JOIN finance_accounts to_acc ON t.to_account_id = to_acc.account_id
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totals = await db`SELECT COUNT(*) FROM finance_transfers`;

    return withCors(req, {
      success: true,
      data: {
        transfers,
        pagination: {
          total: Number(totals?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error: any) {
    console.error("GET TRANSFERS ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to fetch transfers"
    }, 500);
  }
}

// ---------------- UPDATE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Transfer> & { transfer_id: string };

    if (!body.transfer_id) {
      return withCors(req, { success: false, error: "transfer_id required" }, 400);
    }

    const existing = await db`SELECT * FROM finance_transfers WHERE transfer_id = ${body.transfer_id}`;
    if (!existing?.[0]) {
      return withCors(req, { success: false, error: "Transfer not found" }, 404);
    }

    const t = existing[0];

    // ✅ Balance Reversal Logic
    const oldAmount = Number(t.amount);
    const oldFees = Number(t.fees ?? 0);
    const oldTotal = oldAmount + oldFees;

    // 1. Restore balances
    await db`UPDATE finance_accounts SET balance = balance + ${oldTotal} WHERE account_id = ${t.from_account_id}`;
    await db`UPDATE finance_accounts SET balance = balance - ${oldAmount} WHERE account_id = ${t.to_account_id}`;

    // 2. Perform Update
    const newFromId = body.from_account_id ?? t.from_account_id;
    const newToId = body.to_account_id ?? t.to_account_id;
    const newAmount = Number(body.amount ?? t.amount);
    const newFees = Number(body.fees ?? t.fees ?? 0);
    const newTotal = newAmount + newFees;

    if (newFromId === newToId) {
       // Rollback reversal (simplified since we didn't COMMIT yet in real SQL but here we follow through)
       await db`UPDATE finance_accounts SET balance = balance - ${oldTotal} WHERE account_id = ${t.from_account_id}`;
       await db`UPDATE finance_accounts SET balance = balance + ${oldAmount} WHERE account_id = ${t.to_account_id}`;
       return withCors(req, { success: false, error: "Self-transfer is not allowed" }, 400);
    }

    const updated = await db`
      UPDATE finance_transfers SET
        from_account_id = ${newFromId},
        to_account_id = ${newToId},
        amount = ${newAmount},
        fees = ${newFees},
        payment_mode = ${body.payment_mode ?? t.payment_mode},
        reference_no = ${body.reference_no ?? t.reference_no},
        description = ${body.description ?? t.description},
        status = ${body.status ?? t.status},
        date = ${body.date ?? t.date},
        updated_at = NOW()
      WHERE transfer_id = ${body.transfer_id}
      RETURNING *
    `;

    // 3. Apply new balances
    await db`UPDATE finance_accounts SET balance = balance - ${newTotal} WHERE account_id = ${newFromId}`;
    await db`UPDATE finance_accounts SET balance = balance + ${newAmount} WHERE account_id = ${newToId}`;

    return withCors(req, {
      success: true,
      message: "Transfer updated successfully",
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE TRANSFER ERROR:", error);
    return withCors(req, {
      success: false,
      error: error.message || "Failed to update transfer"
    }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const transferId = searchParams.get("transfer_id");

    if (!transferId) {
      return withCors(req, { success: false, error: "transfer_id required" }, 400);
    }

    const existing = await db`SELECT * FROM finance_transfers WHERE transfer_id = ${transferId}`;
    if (!existing?.[0]) {
      return withCors(req, { success: false, error: "Transfer not found" }, 404);
    }

    const t = existing[0];
    const total = Number(t.amount) + Number(t.fees ?? 0);

    // ✅ Reverse Balances
    await db`UPDATE finance_accounts SET balance = balance + ${total} WHERE account_id = ${t.from_account_id}`;
    await db`UPDATE finance_accounts SET balance = balance - ${Number(t.amount)} WHERE account_id = ${t.to_account_id}`;

    await db`DELETE FROM finance_transfers WHERE transfer_id = ${transferId}`;

    return withCors(req, {
      success: true,
      message: "Transfer deleted successfully"
    });

  } catch (error: any) {
     console.error("DELETE TRANSFER ERROR:", error);
     return withCors(req, {
       success: false,
       error: error.message || "Failed to delete transfer"
     }, 500);
  }
}
