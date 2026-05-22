import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- GET METRICS ----------------
export async function GET(req: NextRequest) {
  try {
    // 1. Total Assets
    const totalAssetsRes = await db`SELECT COUNT(*) FROM assets`;
    const totalAssets = Number(totalAssetsRes?.[0]?.count ?? 0);

    // 2. Active Categories
    const activeCategoriesRes = await db`SELECT COUNT(*) FROM asset_categories WHERE status = 'Active'`;
    const activeCategories = Number(activeCategoriesRes?.[0]?.count ?? 0);

    // 3. Status Breakdown
    const statusBreakdownRes = await db`
      SELECT status, COUNT(*) as count 
      FROM assets 
      GROUP BY status
    `;

    // 4. Category Breakdown
    const categoryBreakdownRes = await db`
      SELECT c.category_name, COUNT(a.id) as count 
      FROM asset_categories c
      LEFT JOIN assets a ON c.category_id = a.category_id
      GROUP BY c.category_name
    `;

    // 5. Financial Summary
    const financialRes = await db`SELECT SUM(purchase_cost) as total_value FROM assets`;
    const totalValue = Number(financialRes?.[0]?.total_value ?? 0);

    return withCors(req, {
      success: true,
      data: {
        highlights: {
          total_assets: totalAssets,
          active_categories: activeCategories,
          total_inventory_value: totalValue
        },
        status_distribution: statusBreakdownRes,
        category_distribution: categoryBreakdownRes
      }
    });

  } catch (error: any) {
    console.error("GET ASSET METRICS ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
