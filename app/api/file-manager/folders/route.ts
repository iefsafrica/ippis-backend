import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Folder = {
  folder_id: string;
  name: string;
  parent_id?: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Folder>;

    if (!body.name) {
      return withCors(req, { success: false, error: "Folder name is required" }, 400);
    }

    const folderId = `FL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO file_manager_folders (
        folder_id, name, parent_id, created_at, updated_at
      )
      VALUES (
        ${folderId}, ${body.name}, ${body.parent_id ?? null}, NOW(), NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Folder created successfully",
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE FOLDER ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get("parent_id");
    const folderId = searchParams.get("folder_id");

    // Single folder detail
    if (folderId) {
      const single = await db`SELECT * FROM file_manager_folders WHERE folder_id = ${folderId}`;
      if (!single?.[0]) return withCors(req, { success: false, error: "Folder not found" }, 404);
      return withCors(req, { success: true, data: single[0] });
    }

    // List folders in a parent (null means Root)
    const folders = parentId 
      ? await db`SELECT * FROM file_manager_folders WHERE parent_id = ${parentId} ORDER BY name ASC`
      : await db`SELECT * FROM file_manager_folders WHERE parent_id IS NULL ORDER BY name ASC`;

    return withCors(req, { success: true, data: folders });

  } catch (error: any) {
    console.error("GET FOLDERS ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- UPDATE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Folder>;

    if (!body.folder_id) {
      return withCors(req, { success: false, error: "folder_id required" }, 400);
    }

    const existing = await db`SELECT * FROM file_manager_folders WHERE folder_id = ${body.folder_id}`;
    if (!existing?.[0]) return withCors(req, { success: false, error: "Not found" }, 404);

    const f = existing[0];

    const updated = await db`
      UPDATE file_manager_folders SET
        name = ${body.name ?? f.name},
        parent_id = ${body.parent_id !== undefined ? body.parent_id : f.parent_id},
        updated_at = NOW()
      WHERE folder_id = ${body.folder_id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Folder updated",
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE FOLDER ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folder_id");

    if (!folderId) return withCors(req, { success: false, error: "folder_id required" }, 400);

    // Check if folder is empty (no subfolders or files)
    const subfolders = await db`SELECT COUNT(*) FROM file_manager_folders WHERE parent_id = ${folderId}`;
    const files = await db`SELECT COUNT(*) FROM file_manager_files WHERE folder_id = ${folderId}`;

    if (Number(subfolders?.[0]?.count ?? 0) > 0 || Number(files?.[0]?.count ?? 0) > 0) {
      return withCors(req, { success: false, error: "Folder is not empty. Delete contents first." }, 400);
    }

    await db`DELETE FROM file_manager_folders WHERE folder_id = ${folderId}`;

    return withCors(req, { success: true, message: "Folder deleted" });

  } catch (error: any) {
    console.error("DELETE FOLDER ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
