import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { visibleRows, canSee, canChange, placementFor, placementOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import crypto from "crypto";
import { uploadToBlob, deleteFromBlob } from "@/lib/blob-storage";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- HELPER: RENAME DUPLICATES ----------------
async function getUniqueFileName(name: string, folderId: string | null): Promise<string> {
  const dotIndex = name.lastIndexOf(".");
  const baseName = dotIndex !== -1 ? name.substring(0, dotIndex) : name;
  const extension = dotIndex !== -1 ? name.substring(dotIndex) : "";

  let uniqueName = name;
  let counter = 1;

  while (true) {
    const existing = folderId
      ? await db`SELECT 1 FROM file_manager_files WHERE name = ${uniqueName} AND folder_id = ${folderId}`
      : await db`SELECT 1 FROM file_manager_files WHERE name = ${uniqueName} AND folder_id IS NULL`;

    if (!existing?.[0]) break;

    uniqueName = `${baseName} (${counter})${extension}`;
    counter++;
  }

  return uniqueName;
}

// ---------------- CREATE (UPLOAD) ----------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "files.records.manage");
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const folderId = formData.get("folder_id") as string | null;

    if (!file) {
      return withCors(req, { success: false, error: "No file provided" }, 400);
    }

    // A file in a folder takes the folder's MDA; a top-level file goes to an MDA inside
    // the caller's scope, or to everyone (no MDA) for users with rights across all MDAs
    let placement;
    if (folderId) {
      const [folder] = await db`SELECT company_id, department_id FROM file_manager_folders WHERE folder_id = ${folderId}`;
      if (!canChange(auth.ctx, "files.records.manage", folder)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
      placement = placementOf(folder);
    } else {
      const placed = await placementFor(auth.ctx, "files.records.manage", {
        company_id: formData.get("company_id") ?? formData.get("mda_id"),
        department_id: formData.get("department_id"),
      });
      if (!placed.ok) return withCors(req, { success: false, error: placed.error }, placed.status);
      placement = placed.placement;
    }

    // 1. Resolve Unique Name
    const uniqueName = await getUniqueFileName(file.name, folderId);

    // 2. Upload to Vercel Blob
    const blobUrl = await uploadToBlob(file, uniqueName);

    // 3. Save to DB
    const fileId = `FI-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const result = await db`
      INSERT INTO file_manager_files (
        file_id, name, folder_id, file_url, file_type, file_size, company_id, department_id, created_at, updated_at
      )
      VALUES (
        ${fileId}, ${uniqueName}, ${folderId ?? null}, ${blobUrl}, ${file.type}, ${file.size},
        ${placement.companyId}, ${placement.departmentId}, NOW(), NOW()
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "files.record.created", targetType: "files.record", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "File uploaded successfully",
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPLOAD FILE ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "files.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folder_id");

    // List files in folder (null means Root)
    const files = folderId 
      ? await db`SELECT * FROM file_manager_files WHERE folder_id = ${folderId} ORDER BY created_at DESC`
      : await db`SELECT * FROM file_manager_files WHERE folder_id IS NULL ORDER BY created_at DESC`;

    // Files of the caller's MDA or department, and files for everyone (no MDA)
    return withCors(req, { success: true, data: visibleRows(auth.ctx, "files.records.view", files, true) });

  } catch (error: any) {
    console.error("GET FILES ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "files.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("file_id");

    if (!fileId) return withCors(req, { success: false, error: "file_id required" }, 400);

    const existing = await db`SELECT * FROM file_manager_files WHERE file_id = ${fileId}`;
    if (!canChange(auth.ctx, "files.records.manage", existing?.[0])) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);

    const f = existing[0]!;

    // 1. Delete from Blob
    if (f.file_url) {
      await deleteFromBlob(f.file_url);
    }

    // 2. Delete from DB
    await db`DELETE FROM file_manager_files WHERE file_id = ${fileId}`;

    await runAudited(req, auth.ctx, { action: "files.record.deleted", targetType: "files.record", details: {} }, []);

    return withCors(req, { success: true, message: "File deleted successfully" });

  } catch (error: any) {
    console.error("DELETE FILE ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
