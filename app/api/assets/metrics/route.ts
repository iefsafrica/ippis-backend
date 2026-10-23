import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { moduleScope } from "@/lib/module-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- GET METRICS ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "assets.records.view");
    if (!auth.ok) return auth.response;

    // Only the assets of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "assets.records.view");

    // 1. Total Assets
    const totalAssetsRes = await db`SELECT COUNT(*) FROM assets a WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))`;
    const totalAssets = Number(totalAssetsRes?.[0]?.count ?? 0);

    // 2. Active Categories
    const activeCategoriesRes = await db`SELECT COUNT(*) FROM asset_categories WHERE status = 'Active'`;
    const activeCategories = Number(activeCategoriesRes?.[0]?.count ?? 0);

    // 3. Status Breakdown
    const statusBreakdownRes = await db`
      SELECT a.status, COUNT(*) as count 
      FROM assets a
      WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
      GROUP BY a.status
    `;

    // 4. Category Breakdown
    const categoryBreakdownRes = await db`
      SELECT c.category_name, COUNT(a.id) as count 
      FROM asset_categories c
      LEFT JOIN assets a ON c.category_id = a.category_id AND (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))
      GROUP BY c.category_name
    `;

    // 5. Financial Summary
    const financialRes = await db`SELECT SUM(a.purchase_cost) as total_value FROM assets a WHERE (${sc.all}::boolean OR a.company_id = ANY(${sc.companyIds}::int[]) OR a.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND a.company_id IS NULL))`;
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
