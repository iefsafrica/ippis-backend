import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { uploadFile } from "@/lib/document-storage"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const registrationId = formData.get("registrationId") as string

    if (!registrationId) {
      return NextResponse.json(
        {
          error: "Missing registration ID",
        },
        { status: 400 },
      )
    }

    // Process file uploads
    const appointmentLetter = formData.get("appointmentLetter") as File
    const educationalCertificates = formData.get("educationalCertificates") as File
    const promotionLetter = formData.get("promotionLetter") as File
    const otherDocuments = formData.get("otherDocuments") as File
    const profileImage = formData.get("profileImage") as File
    const signature = formData.get("signature") as File

    // Validate required files
    if (!appointmentLetter || !educationalCertificates || !profileImage || !signature) {
      return NextResponse.json(
        {
          error: "Missing required files",
        },
        { status: 400 },
      )
    }

    // In a real app, you would upload these files to a storage service
    // For now, we'll use placeholder paths
    const appointmentLetterPath = await uploadFile(appointmentLetter, registrationId, "appointment")
    const educationalCertificatesPath = await uploadFile(educationalCertificates, registrationId, "education")
    const promotionLetterPath = promotionLetter ? await uploadFile(promotionLetter, registrationId, "promotion") : null
    const otherDocumentsPath = otherDocuments ? await uploadFile(otherDocuments, registrationId, "other") : null
    const profileImagePath = await uploadFile(profileImage, registrationId, "profile")
    const signaturePath = await uploadFile(signature, registrationId, "signature")

    // Save document upload information
    await db.execute(`
      INSERT INTO document_uploads (
        registration_id, appointment_letter_path, educational_certificates_path,
        promotion_letter_path, other_documents_path, profile_image_path, signature_path
      )
      VALUES (
        '${registrationId}', '${appointmentLetterPath}', '${educationalCertificatesPath}',
        ${promotionLetterPath ? `'${promotionLetterPath}'` : "NULL"}, 
        ${otherDocumentsPath ? `'${otherDocumentsPath}'` : "NULL"}, 
        '${profileImagePath}', '${signaturePath}'
      )
      ON CONFLICT (registration_id) 
      DO UPDATE SET 
        appointment_letter_path = '${appointmentLetterPath}',
        educational_certificates_path = '${educationalCertificatesPath}',
        promotion_letter_path = ${promotionLetterPath ? `'${promotionLetterPath}'` : "NULL"},
        other_documents_path = ${otherDocumentsPath ? `'${otherDocumentsPath}'` : "NULL"},
        profile_image_path = '${profileImagePath}',
        signature_path = '${signaturePath}',
        upload_date = CURRENT_TIMESTAMP
    `)

    // Update the registration step
    await db.execute(`
      UPDATE registrations 
      SET current_step = 'review', updated_at = CURRENT_TIMESTAMP 
      WHERE registration_id = '${registrationId}'
    `)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error("Document upload error:", error)
    return NextResponse.json(
      {
        error: "Failed to save document uploads",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
