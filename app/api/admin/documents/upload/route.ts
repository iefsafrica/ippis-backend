import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// Vercel Blob Token
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// Upload file to Vercel Blob storage
async function uploadToBlob(file: File, fileName: string) {
  const res = await fetch(`https://blob.vercel-storage.com/${fileName}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      "Content-Type": file.type,
    },
    body: file,
  });

  if (!res.ok) {
    throw new Error(`Failed to upload ${fileName}: ${res.statusText}`);
  }

  // Return the public URL
  return `https://blob.vercel-storage.com/${fileName}`;
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// POST: Upload document links
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // Required fields
    const requiredFields = [
      "registration_id",
      "appointment_letter_path",
      "educational_certificates_path",
      "profile_image_path",
      "signature_path",
    ];

    const missingFields = requiredFields.filter((field) => !formData.get(field));
    if (missingFields.length > 0) {
      return withCors(req, {
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
      }, 400);
    }

    const registrationId = formData.get("registration_id")!.toString();

    // ? Check if registration_id exists in registrations
    const registrationExists = await sql`
      SELECT 1 FROM registrations WHERE registration_id = ${registrationId};
    `;

    if (!registrationExists || registrationExists.length === 0) {
      return withCors(req, {
        success: false,
        error: `Invalid registration_id: ${registrationId} does not exist in registrations table`,
      }, 400);
    }

    // Upload files to Blob storage
    const appointmentLetterFile = formData.get("appointment_letter_path") as File;
    const educationalCertificatesFile = formData.get("educational_certificates_path") as File;
    const profileImageFile = formData.get("profile_image_path") as File;
    const signatureFile = formData.get("signature_path") as File;
    const promotionLetterFile = formData.get("promotion_letter_path") as File | null;
    const otherDocumentsFile = formData.get("other_documents_path") as File | null;

    const appointmentLetterUrl = await uploadToBlob(appointmentLetterFile, `${registrationId}-appointment-letter-${appointmentLetterFile.name}`);
    const educationalCertificatesUrl = await uploadToBlob(educationalCertificatesFile, `${registrationId}-educational-certificates-${educationalCertificatesFile.name}`);
    const profileImageUrl = await uploadToBlob(profileImageFile, `${registrationId}-profile-image-${profileImageFile.name}`);
    const signatureUrl = await uploadToBlob(signatureFile, `${registrationId}-signature-${signatureFile.name}`);

    const promotionLetterUrl = promotionLetterFile ? await uploadToBlob(promotionLetterFile, `${registrationId}-promotion-letter-${promotionLetterFile.name}`) : null;
    const otherDocumentsUrl = otherDocumentsFile ? await uploadToBlob(otherDocumentsFile, `${registrationId}-other-documents-${otherDocumentsFile.name}`) : null;

    const status = formData.get("status")?.toString() || "pending";
    const uploadDate = new Date().toISOString();

    // Insert into document_uploads
    const result = await sql`
      INSERT INTO document_uploads (
        registration_id,
        appointment_letter_path,
        educational_certificates_path,
        promotion_letter_path,
        other_documents_path,
        profile_image_path,
        signature_path,
        status,
        upload_date
      ) VALUES (
        ${registrationId},
        ${appointmentLetterUrl},
        ${educationalCertificatesUrl},
        ${promotionLetterUrl},
        ${otherDocumentsUrl},
        ${profileImageUrl},
        ${signatureUrl},
        ${status},
        ${uploadDate}
      ) RETURNING *;
    `;

    return withCors(req, {
      success: true,
      message: "Documents uploaded successfully",
      data: result[0],
    });

  } catch (error) {
    console.error("Error uploading documents:", error);
    return withCors(req, {
      success: false,
      error: "Failed to upload documents",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
