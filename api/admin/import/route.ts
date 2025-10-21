import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { validateCSV } from "@/lib/csv-parser"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const validateOnly = formData.get("validate") === "true"

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

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "CSV validation failed",
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          totalRecords: validationResult.totalRecords,
          validRecords: validationResult.validRecordsCount,
        },
        { status: 400 },
      )
    }

    // If this is just validation, return the validation results
    if (validateOnly) {
      return NextResponse.json({
        success: true,
        message: "CSV file is valid",
        totalRecords: validationResult.totalRecords,
        validRecords: validationResult.validRecordsCount,
        warnings: validationResult.warnings,
      })
    }

    // Process and insert records
    const sql = neon(process.env.DATABASE_URL!)
    const insertedCount = await insertRecords(sql, validationResult.validRecords)

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${insertedCount} records`,
      data: {
        importedRecords: insertedCount,
        totalRecords: validationResult.totalRecords,
      },
    })
  } catch (error) {
    console.error("Error importing CSV:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to import CSV",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// Update the insertRecords function to ensure records are added in descending order
// and don't override existing records

async function insertRecords(sql, records) {
  let insertedCount = 0

  for (const record of records) {
    try {
      // Extract fields with case-insensitive matching
      const getField = (possibleNames) => {
        for (const name of possibleNames) {
          for (const key of Object.keys(record)) {
            if (key.toLowerCase() === name.toLowerCase()) {
              return record[key]
            }
          }
        }
        return null
      }

      const surname = getField(["surname", "lastname", "familyname"])
      const firstname = getField(["firstname", "firstName", "givenname"])
      const email = getField(["email"])
      const department = getField(["department"])
      const position = getField(["position", "rankposition"])

      // Check if email already exists in pending_employees
      const existingRecord = await sql`
        SELECT email FROM pending_employees WHERE email = ${email}
      `

      // Skip if email already exists
      if (existingRecord.length > 0) {
        console.log(`Skipping duplicate email: ${email}`)
        continue
      }

      // Generate a unique registration ID
      const registrationId = `REG-${Date.now()}-${Math.floor(Math.random() * 1000)}`

      // Create metadata from all fields except the ones we're explicitly using
      const metadata = { ...record }
      delete metadata.surname
      delete metadata.firstname
      delete metadata.email
      delete metadata.department
      delete metadata.position

      // Insert into database with the new columns
      await sql`
        INSERT INTO pending_employees (
          registration_id,
          surname,
          firstname,
          email,
          department,
          position,
          status,
          source,
          metadata,
          created_at
        ) VALUES (
          ${registrationId},
          ${surname || "Unknown"},
          ${firstname || ""},
          ${email},
          ${department || null},
          ${position || null},
          'pending_approval',
          'import',
          ${JSON.stringify(metadata)},
          NOW()
        )
      `

      insertedCount++
    } catch (error) {
      console.error(`Error inserting record:`, error, record)
      // Continue with next record
    }
  }

  return insertedCount
}
