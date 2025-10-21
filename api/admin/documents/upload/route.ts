import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { put } from "@vercel/blob"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const registration_id = formData.get("registration_id") as string
    if (!registration_id) {
      return NextResponse.json({ error: "registration_id is required" }, { status: 400 })
    }

    // Check if the registration_id exists in registrations table
    const registrationCheck = await db.query(
      `SELECT registration_id FROM registrations WHERE registration_id = $1`,
      [registration_id]
    )

    if (registrationCheck.rowCount === 0) {
      return NextResponse.json(
        { error: `Registration ID '${registration_id}' does not exist.` },
        { status: 400 }
      )
    }

    // Define mapping from input field name to DB column name
    const fileFields = {
      appointment_letter: "appointment_letter_path",
      educational_certificates: "educational_certificates_path",
      promotion_letter: "promotion_letter_path",
      other_documents: "other_documents_path",
      profile_image: "profile_image_path",
      signature: "signature_path",
    } as const

    const fileUrls: Record<string, string | null> = {}

    // Upload files to Vercel Blob
    for (const [inputName, dbColumn] of Object.entries(fileFields)) {
      const file = formData.get(inputName) as File | null
      if (file && file.size > 0) {
        const blob = await put(`${registration_id}/${inputName}-${Date.now()}-${file.name}`, file, {
          access: "public",
          addRandomSuffix: true,
        })
        fileUrls[dbColumn] = blob.url
      } else {
        fileUrls[dbColumn] = null
      }
    }

    // Validate required files
    const requiredFields = {
      appointment_letter_path: "Appointment letter",
      educational_certificates_path: "Educational certificates",
    }

    for (const [key, label] of Object.entries(requiredFields)) {
      if (!fileUrls[key]) {
        return NextResponse.json({ error: `${label} is required` }, { status: 400 })
      }
    }

    // Insert or update document_uploads table
    const query = `
      INSERT INTO document_uploads (
        registration_id,
        appointment_letter_path,
        educational_certificates_path,
        promotion_letter_path,
        other_documents_path,
        profile_image_path,
        signature_path,
        status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'uploaded'
      )
      ON CONFLICT (registration_id) DO UPDATE SET
        appointment_letter_path = EXCLUDED.appointment_letter_path,
        educational_certificates_path = EXCLUDED.educational_certificates_path,
        promotion_letter_path = EXCLUDED.promotion_letter_path,
        other_documents_path = EXCLUDED.other_documents_path,
        profile_image_path = EXCLUDED.profile_image_path,
        signature_path = EXCLUDED.signature_path,
        status = 'uploaded',
        upload_date = NOW()
      RETURNING *;
    `

    const result = await db.query(query, [
      registration_id,
      fileUrls.appointment_letter_path,
      fileUrls.educational_certificates_path,
      fileUrls.promotion_letter_path,
      fileUrls.other_documents_path,
      fileUrls.profile_image_path,
      fileUrls.signature_path,
    ])

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: "Documents uploaded successfully",
    })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json({ error: "Failed to upload documents" }, { status: 500 })
  }
}
