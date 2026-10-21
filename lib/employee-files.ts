import { put } from "@vercel/blob";

/**
 * File uploads from the employee portal and HR document screens.
 * Files go to blob storage; only the URL and metadata are kept in the database.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/zip": ["zip"],
};

export const ALLOWED_EXTENSIONS = [...new Set(Object.values(ALLOWED_TYPES).flat())];

export type StoredFile = { url: string; fileName: string; contentType: string; sizeBytes: number };

function safeName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (cleaned || "file").slice(-120);
}

/** Checks the uploaded file; returns why it is refused, or null. */
export function fileProblem(file: unknown): string | null {
  if (!(file instanceof File)) return "A file is required (form field \"file\")";
  if (file.size === 0) return "The file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byType = ALLOWED_TYPES[file.type];
  // Browsers sometimes send an empty or generic type; then the extension decides
  const allowed = byType ? byType.includes(ext) : ALLOWED_EXTENSIONS.includes(ext) && (!file.type || file.type === "application/octet-stream");
  if (!allowed) return `This file type is not accepted. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
  return null;
}

/**
 * Stores the file in Vercel Blob under a path that cannot collide with another
 * upload, and returns the file's public URL as reported by the service.
 */
export async function storeFile(file: File, folder: string): Promise<StoredFile> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");

  const name = safeName(file.name);
  const contentType = file.type || "application/octet-stream";
  const blob = await put(`${folder.replace(/^\/+|\/+$/g, "")}/${name}`, file, {
    access: "public",
    token,
    contentType,
    // A random suffix keeps uploads with the same name apart and makes URLs hard to guess
    addRandomSuffix: true,
  });
  return { url: blob.url, fileName: name, contentType, sizeBytes: file.size };
}
