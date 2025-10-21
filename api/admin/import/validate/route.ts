import { NextResponse } from "next/server"
import { validateCSV } from "@/lib/csv-parser"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
    }

    // Check file type
    if (!file.name.endsWith(".csv")) {
      return NextResponse.json({ success: false, error: "Only CSV files are supported" }, { status: 400 })
    }

    const fileContent = await file.text()

    // Define validation options based on the IPPIS schema
    const validationOptions = {
      requiredFields: ["Surname", "FirstName", "Email"],
      dateFields: ["DateOfBirth", "DateOfFirstAppointment"],
      emailFields: ["Email"],
      numericFields: ["PhoneNumber", "NextOfKinPhoneNumber", "AccountNumber"],
    }

    // Validate the CSV content
    const validationResult = validateCSV(fileContent, validationOptions)

    return NextResponse.json({
      success: validationResult.success,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      totalRecords: validationResult.totalRecords,
      validRecords: validationResult.validRecordsCount,
      invalidRecords: validationResult.invalidRecordsCount,
    })
  } catch (error) {
    console.error("Error validating CSV:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to validate CSV",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
