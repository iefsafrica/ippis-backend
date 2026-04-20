import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- GET DASHBOARD ----------------
export async function GET(req: NextRequest) {
  try {
    // 1. Storage Stats
    const statsRes = await db`
      SELECT 
        COUNT(*) as total_files,
        SUM(file_size) as total_size
      FROM file_manager_files
    `;
    const totalFiles = Number(statsRes?.[0]?.total_files ?? 0);
    const totalSize = Number(statsRes?.[0]?.total_size ?? 0);

    // 2. Folder Stats
    const folderRes = await db`SELECT COUNT(*) as total_folders FROM file_manager_folders`;
    const totalFolders = Number(folderRes?.[0]?.total_folders ?? 0);

    // 3. Recent Files
    const recentFiles = await db`
      SELECT * FROM file_manager_files 
      ORDER BY created_at DESC 
      LIMIT 10
    `;

    // 4. File Type Breakdown
    const typeBreakdown = await db`
      SELECT file_type, COUNT(*) as count, SUM(file_size) as size
      FROM file_manager_files
      GROUP BY file_type
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
