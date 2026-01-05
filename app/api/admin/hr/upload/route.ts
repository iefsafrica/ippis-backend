import { put } from "@vercel/blob";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../../../lib/cors";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return withCors(req, {
        success: false,
        error: "No file provided",
      }, 400);
    }

    const blob = await put(
      `employee-warnings/${Date.now()}-${file.name}`,
      file,
      {
        access: "public",
      }
    );

    return withCors(req, {
      success: true,
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error("Blob upload error:", error);
    return withCors(req, {
      success: false,
      error: "File upload failed",
    }, 500);
  }
}
