import { type NextRequest, NextResponse } from "next/server"
import { saveRegistrationData } from "@/lib/registration-service"
import { uploadDocument } from "@/lib/document-service"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Extract basic form data
    const registrationData = {
      // Verification data
      bvn: formData.get("bvn") as string,
      bvnVerified: formData.get("bvnVerified") === "true",
      nin: formData.get("nin") as string,
      ninVerified: formData.get("ninVerified") === "true",

      // Personal information
      title: formData.get("title") as string,
      surname: formData.get("surname") as string,
      firstName: formData.get("firstName") as string,
      otherNames: formData.get("otherNames") as string,
      phoneNumber: formData.get("phoneNumber") as string,
      email: formData.get("email") as string,
      dateOfBirth: formData.get("dateOfBirth") as string,
      sex: formData.get("sex") as string,
      maritalStatus: formData.get("maritalStatus") as string,
      stateOfOrigin: formData.get("stateOfOrigin") as string,
      lga: formData.get("lga") as string,
      stateOfResidence: formData.get("stateOfResidence") as string,
      addressStateOfResidence: formData.get("addressStateOfResidence") as string,
      nextOfKinName: formData.get("nextOfKinName") as string,
      nextOfKinRelationship: formData.get("nextOfKinRelationship") as string,
      nextOfKinPhoneNumber: formData.get("nextOfKinPhoneNumber") as string,
      nextOfKinAddress: formData.get("nextOfKinAddress") as string,

      // Employment information
      employmentIdNo: formData.get("employmentIdNo") as string,
      serviceNo: formData.get("serviceNo") as string,
      fileNo: formData.get("fileNo") as string,
      rankPosition: formData.get("rankPosition") as string,
      department: formData.get("department") as string,
      organization: formData.get("organization") as string,
      employmentType: formData.get("employmentType") as string,
      probationPeriod: formData.get("probationPeriod") as string,
      workLocation: formData.get("workLocation") as string,
      dateOfFirstAppointment: formData.get("dateOfFirstAppointment") as string,
      gl: formData.get("gl") as string,
      step: formData.get("step") as string,
      salaryStructure: formData.get("salaryStructure") as string,
      cadre: formData.get("cadre") as string,
      nameOfBank: formData.get("nameOfBank") as string,
      accountNumber: formData.get("accountNumber") as string,
      pfaName: formData.get("pfaName") as string,
      rsapin: formData.get("rsapin") as string,
      educationalBackground: formData.get("educationalBackground") as string,
      certifications: formData.get("certifications") as string,

      // Declaration
      declaration: formData.get("declaration") === "true",

      // Metadata
      submissionDate: new Date().toISOString(),
      status: "pending_approval",
      registrationId: "IPPIS" + Math.floor(Math.random() * 900000 + 100000),
    }

    // Process document uploads
    const documentFiles = {
      appointmentLetter: formData.get("appointmentLetter") as File,
      educationalCertificates: formData.get("educationalCertificates") as File,
      promotionLetter: formData.get("promotionLetter") as File,
      otherDocuments: formData.get("otherDocuments") as File,
      profileImage: formData.get("profileImage") as File,
      signature: formData.get("signature") as File,
    }

    // Upload documents and get their URLs
    const documentUrls = {}
    for (const [key, file] of Object.entries(documentFiles)) {
      if (file && file.size > 0) {
        const url = await uploadDocument(file, `${registrationData.registrationId}/${key}`)
        documentUrls[key] = url
      }
    }

    // Save registration data with document URLs
    const result = await saveRegistrationData({
      ...registrationData,
      documents: documentUrls,
    })

    return NextResponse.json({
      success: true,
      message: "Registration successful",
      registrationId: registrationData.registrationId,
      id: result.id,
    })
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json({ success: false, message: "Registration failed", error: error.message }, { status: 500 })
  }
}
