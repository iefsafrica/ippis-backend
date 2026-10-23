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

// ---------------- GET DASHBOARD ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "files.records.view");
    if (!auth.ok) return auth.response;

    // What the caller can see: their MDA or department, and items for everyone
    const sc = moduleScope(auth.ctx, "files.records.view");

    // 1. Storage Stats
    const statsRes = await db`
      SELECT COUNT(*) as total_files, SUM(f.file_size) as total_size
      FROM file_manager_files f
      WHERE (${sc.all}::boolean OR f.company_id = ANY(${sc.companyIds}::int[]) OR f.department_id = ANY(${sc.departmentIds}::int[]) OR (true::boolean AND f.company_id IS NULL))
    `;
    const totalFiles = Number(statsRes?.[0]?.total_files ?? 0);
    const totalSize = Number(statsRes?.[0]?.total_size ?? 0);

    // 2. Folder Stats
    const folderRes = await db`SELECT COUNT(*) as total_folders FROM file_manager_folders f WHERE (${sc.all}::boolean OR f.company_id = ANY(${sc.companyIds}::int[]) OR f.department_id = ANY(${sc.departmentIds}::int[]) OR (true::boolean AND f.company_id IS NULL))`;
    const totalFolders = Number(folderRes?.[0]?.total_folders ?? 0);

    // 3. Recent Files
    const recentFiles = await db`
      SELECT * FROM file_manager_files f
      WHERE (${sc.all}::boolean OR f.company_id = ANY(${sc.companyIds}::int[]) OR f.department_id = ANY(${sc.departmentIds}::int[]) OR (true::boolean AND f.company_id IS NULL))
      ORDER BY f.created_at DESC
      LIMIT 10
    `;

    // 4. File Type Breakdown
    const typeBreakdown = await db`
      SELECT f.file_type, COUNT(*) as count, SUM(f.file_size) as size
      FROM file_manager_files f
      WHERE (${sc.all}::boolean OR f.company_id = ANY(${sc.companyIds}::int[]) OR f.department_id = ANY(${sc.departmentIds}::int[]) OR (true::boolean AND f.company_id IS NULL))
      GROUP BY f.file_type
    `;

    return withCors(req, {
      success: true,
      data: {
        highlights: {
          total_files: totalFiles,
          total_folders: totalFolders,
          total_storage_used: totalSize, // bytes
        },
        recent_activity: recentFiles,
        distribution: typeBreakdown
      }
    });

  } catch (error: any) {
    console.error("GET FILE DASHBOARD ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
