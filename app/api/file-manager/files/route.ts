import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest, NextResponse } from "next/server";
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
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const folderId = formData.get("folder_id") as string | null;

    if (!file) {
      return withCors(req, { success: false, error: "No file provided" }, 400);
    }

    // 1. Resolve Unique Name
    const uniqueName = await getUniqueFileName(file.name, folderId);

    // 2. Upload to Vercel Blob
    const blobUrl = await uploadToBlob(file, uniqueName);

    // 3. Save to DB
    const fileId = `FI-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const result = await db`
      INSERT INTO file_manager_files (
        file_id, name, folder_id, file_url, file_type, file_size, created_at, updated_at
      )
      VALUES (
        ${fileId}, ${uniqueName}, ${folderId ?? null}, ${blobUrl}, ${file.type}, ${file.size}, NOW(), NOW()
      )
      RETURNING *
    `;

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
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folder_id");

    // List files in folder (null means Root)
    const files = folderId 
      ? await db`SELECT * FROM file_manager_files WHERE folder_id = ${folderId} ORDER BY created_at DESC`
      : await db`SELECT * FROM file_manager_files WHERE folder_id IS NULL ORDER BY created_at DESC`;

    return withCors(req, { success: true, data: files });

  } catch (error: any) {
    console.error("GET FILES ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("file_id");

    if (!fileId) return withCors(req, { success: false, error: "file_id required" }, 400);

    const existing = await db`SELECT * FROM file_manager_files WHERE file_id = ${fileId}`;
    if (!existing?.[0]) return withCors(req, { success: false, error: "File not found" }, 404);

    const f = existing[0];

    // 1. Delete from Blob
    if (f.file_url) {
      await deleteFromBlob(f.file_url);
    }

    // 2. Delete from DB
    await db`DELETE FROM file_manager_files WHERE file_id = ${fileId}`;

    return withCors(req, { success: true, message: "File deleted successfully" });

  } catch (error: any) {
    console.error("DELETE FILE ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
