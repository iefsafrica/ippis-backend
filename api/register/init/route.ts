// import { NextResponse } from "next/server"
// import { neon } from "@neondatabase/serverless"
// import { generateRegistrationId } from "@/lib/db"

// // Create a SQL client using neon
// const sqlClient = neon(process.env.DATABASE_URL!)

// export async function POST() {
//   try {
//     // Generate a unique registration ID
//     const registrationId = await generateRegistrationId()

//     // Create a new registration record
//     const result = await sqlClient`
//       INSERT INTO registrations (registration_id, status, current_step)
//       VALUES (${registrationId}, 'draft', 'verification')
//       RETURNING *
//     `

//     if (!result || result.length === 0) {
//       console.error("Failed to create registration record")
//       return NextResponse.json({ error: "Failed to initialize registration" }, { status: 500 })
//     }

//     // Add to history
//     await sqlClient`
//       INSERT INTO registration_history (registration_id, action, details) 
//       VALUES (${registrationId}, 'created', 'Registration initiated')
//     `

//     return NextResponse.json({
//       success: true,
//       registrationId,
//       message: "Registration initialized successfully",
//     })
//   } catch (error) {
//     console.error("Error initializing registration:", error)
//     return NextResponse.json({ error: "Failed to initialize registration" }, { status: 500 })
//   }
// }
import { NextResponse } from "next/server"
import {
  createRegistration,
  saveVerificationData,
  savePersonalInfo,
  saveEmploymentInfo,
  saveDocumentUploads,
  submitRegistration,
  getRegistration,
} from "@/lib/db"

interface RequestPayload {
  action: string
  data?: Record<string, any>
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestPayload

    // Validate request structure
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { action, data } = body

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "Missing or invalid action" }, { status: 400 })
    }

    let result: any

    switch (action) {
      case "createRegistration":
        result = await createRegistration()
        return NextResponse.json({
          success: true,
          registrationId: result.registrationId,
          message: "Registration initialized successfully",
        })

      case "saveVerification":
        if (!data) return missingDataError("verification")
        result = await saveVerificationData(data)
        break

      case "savePersonalInfo":
        if (!data) return missingDataError("personal info")
        result = await savePersonalInfo(data)
        break

      case "saveEmploymentInfo":
        if (!data) return missingDataError("employment info")
        result = await saveEmploymentInfo(data)
        break

      case "saveDocuments":
        if (!data) return missingDataError("document uploads")
        result = await saveDocumentUploads(data)
        break

      case "submit":
        if (!data?.registrationId || typeof data.declaration !== "boolean") {
          return NextResponse.json(
            { error: "Missing registrationId or declaration in submission data" },
            { status: 400 }
          )
        }
        result = await submitRegistration(data.registrationId, data.declaration)
        break

      case "getRegistration":
        if (!data?.registrationId) {
          return NextResponse.json({ error: "Missing registrationId" }, { status: 400 })
        }
        result = await getRegistration(data.registrationId)
        break

      default:
        return NextResponse.json({ error: "Invalid action specified" }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: result })

  } catch (error: any) {
    console.error("Registration API Error:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error?.message || "Unknown error" },
      { status: 500 }
    )
  }
}

function missingDataError(name: string) {
  return NextResponse.json(
    { error: `Missing ${name} data` },
    { status: 400 }
  )
}
