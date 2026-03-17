import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import FormData from "form-data";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   File Upload Config
------------------------- */
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN!;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png"];

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   POST: DOCUMENT UPLOAD
------------------------- */
export async function POST(req: NextRequest) {
  try {
    const registration_id = req.headers.get("x-registration-id");
    if (!registration_id) {
      return withCors(req, { success: false, message: "Missing registration ID in headers" }, 400);
    }

    // Check registration exists
    const existing = await sql`
      SELECT registration_id
      FROM registrations
      WHERE registration_id = ${registration_id}
    `;
    if (existing.length === 0) {
      return withCors(req, { success: false, message: "Invalid registration ID" }, 404);
    }

    // Parse multipart form (Node FormData-compatible)
    const formData = await req.formData();

    const uploadFile = async (fieldName: string, required = false) => {
      const file = formData.get(fieldName) as File | null;
      if (!file) {
        if (required) throw new Error(`${fieldName} is required`);
        return null;
      }

      // Validate file type and size
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !ALLOWED_EXT.includes(ext)) throw new Error(`${fieldName} has invalid file type`);
      if (file.size > MAX_FILE_SIZE) throw new Error(`${fieldName} exceeds 5MB`);

      // Convert File to Buffer for Node
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Create Node FormData
      const blobForm = new FormData();
      blobForm.append("file", buffer, {
        filename: file.name,
        contentType: file.type,
      });

      // Upload to Vercel Blob
      const res = await fetch("https://api.vercel.com/v1/blob", {
        method: "POST",
        headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
        body: blobForm as any, // form-data instance
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Blob Upload Failed for ${fieldName}:`, text);
        throw new Error(`Failed to upload ${fieldName}`);
      }

      const blobData = (await res.json()) as { url: string; key: string };
      return blobData.url;
    };

    // Upload all required/optional files
    const appointmentLetter = await uploadFile("appointment_letter", true);
    const educationalCertificates = await uploadFile("educational_certificates", true);
    const promotionLetter = await uploadFile("promotion_letter", false);
    const otherDocuments = await uploadFile("other_documents", false);
    const profileImage = await uploadFile("profile_image", true);
    const signature = await uploadFile("signature", true);

    // Insert uploaded URLs into database
    await sql`
      INSERT INTO employee_documents (
        registration_id,
        appointment_letter,
        educational_certificates,
        promotion_letter,
        other_documents,
        profile_image,
        signature
      )
      VALUES (
        ${registration_id},
        ${appointmentLetter},
        ${educationalCertificates},
        ${promotionLetter ?? null},
        ${otherDocuments ?? null},
        ${profileImage},
        ${signature}
      )
    `;

    // Update registration step
    await sql`
      UPDATE registrations
      SET current_step = 'completed'
      WHERE registration_id = ${registration_id}
    `;

    return withCors(req, {
      success: true,
      message: "Documents uploaded successfully",
      next_step: "completed",
    });
  } catch (error: any) {
    console.error("DOCUMENT UPLOAD ERROR:", error);
    return withCors(req, {
      success: false,
      message: "Failed to upload documents",
      error: error.message,
    }, 500);
  }
}