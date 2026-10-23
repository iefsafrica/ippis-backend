import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { moduleScope } from "@/lib/module-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ----------------- TYPES -----------------
type SumResult = {
  total: string | number | null;
};

type AccountRow = {
  account_name: string;
  bank_name: string;
  current_balance: string | number;
  previous_balance: string | number | null;
  updated_at: string;
};

// ----------------- CORS -----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ----------------- ANALYTICS -----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "finance.records.view");
    if (!auth.ok) return auth.response;

    // Only the accounts of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "finance.records.view");

    // ---------------- TOTAL CURRENT BALANCE ----------------
    const totalRes = await db`
      SELECT COALESCE(SUM(a.balance),0) as total FROM finance_accounts a
      WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
    ` as unknown as SumResult[];

    const totalBalance = Number(totalRes?.[0]?.total ?? 0);

    // ---------------- PREVIOUS PERIOD ----------------
    const prevRes = await db`
      SELECT COALESCE(SUM(h.balance),0) as total
      FROM finance_account_history h
      JOIN finance_accounts a ON a.account_id = h.account_id
      WHERE h.recorded_at <= NOW() - INTERVAL '30 days'
        AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
    ` as unknown as SumResult[];

    const previousBalance = Number(prevRes?.[0]?.total ?? 0);

    // ---------------- CHANGE ----------------
    const change = totalBalance - previousBalance;

    const percentChange =
      previousBalance === 0
        ? 0
        : (change / previousBalance) * 100;

    // ---------------- ACCOUNT LEVEL ----------------
    const accounts = await db`
      SELECT 
        fa.account_name,
        fa.bank_name,
        fa.balance as current_balance,
        (
          SELECT balance FROM finance_account_history h
          WHERE h.account_id = fa.account_id
          ORDER BY recorded_at ASC
          LIMIT 1
        ) as previous_balance,
        fa.updated_at
      FROM finance_accounts fa
      WHERE (${sc.all}::boolean OR fa.company_id = ANY(${sc.companyIds}::int[]) OR fa.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND fa.company_id IS NULL))
    ` as unknown as AccountRow[];

    let increase = 0;
    let decrease = 0;

    const accountDetails = accounts.map((acc) => {
      const prev = Number(acc.previous_balance ?? 0);
      const curr = Number(acc.current_balance ?? 0);

      const diff = curr - prev;

      const pct =
        prev === 0
          ? 0
          : (diff / prev) * 100;

      if (diff > 0) increase++;
      if (diff < 0) decrease++;

      return {
        account_name: acc.account_name,
        bank: acc.bank_name,
        current_balance: curr,
        previous_balance: prev,
        change: diff,
        percent_change: pct,
        last_updated: acc.updated_at
      };
    });

    // ---------------- TREND ----------------
    const trendRaw = await db`
      SELECT 
        DATE(h.recorded_at) as date,
        SUM(h.balance) as total
      FROM finance_account_history h
      JOIN finance_accounts a ON a.account_id = h.account_id
      WHERE h.recorded_at >= NOW() - INTERVAL '30 days'
        AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
      GROUP BY DATE(h.recorded_at)
      ORDER BY date ASC
    ` as any[];

    const trend = trendRaw.map((t) => ({
      date: t.date,
      total: Number(t.total)
    }));

    return withCors(req, {
      success: true,
      data: {
        summary: {
          totalBalance,
          previousBalance,
          change,
          percentChange,
          increaseAccounts: increase,
          decreaseAccounts: decrease,
          totalAccounts: accounts.length
        },
        trend,
        accountDetails
      }
    });

  } catch (error) {
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch analytics",
        details: String(error)
      },
      500
    );
  }
}