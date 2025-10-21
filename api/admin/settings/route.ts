import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"

// Define schema for settings validation
const settingsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  systemNotifications: z.boolean().optional(),
  documentVerificationMode: z.string().optional(),
  emailServer: z.string().optional(),
  emailPort: z.string().optional(),
  emailUsername: z.string().optional(),
  emailPassword: z.string().optional(),
  emailFrom: z.string().optional(),
  emailReplyTo: z.string().optional(),
  emailTemplate: z.string().optional(),
  systemName: z.string().optional(),
  systemLogo: z.string().optional(),
  systemTheme: z.string().optional(),
  systemLanguage: z.string().optional(),
  systemTimezone: z.string().optional(),
  systemDateFormat: z.string().optional(),
  systemTimeFormat: z.string().optional(),
  systemCurrency: z.string().optional(),
  systemDecimalSeparator: z.string().optional(),
  systemThousandSeparator: z.string().optional(),
})

export async function GET() {
  try {
    // In a real app, fetch settings from database
    // For now, return mock settings
    return NextResponse.json({
      success: true,
      data: {
        emailNotifications: true,
        systemNotifications: true,
        documentVerificationMode: "manual",
        emailServer: process.env.EMAIL_SERVER || "",
        emailPort: process.env.EMAIL_PORT || "",
        emailUsername: process.env.EMAIL_USER || "",
        emailPassword: "", // Don't return actual password
        emailFrom: process.env.EMAIL_FROM || "",
        emailReplyTo: process.env.EMAIL_REPLY_TO || "",
        emailTemplate: "",
        systemName: "IPPIS Admin Portal",
        systemLogo: "",
        systemTheme: "light",
        systemLanguage: "en",
        systemTimezone: "Africa/Lagos",
        systemDateFormat: "DD/MM/YYYY",
        systemTimeFormat: "HH:mm",
        systemCurrency: "NGN",
        systemDecimalSeparator: ".",
        systemThousandSeparator: ",",
      },
    })
  } catch (error) {
    console.error("Error fetching settings:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch settings",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate settings
    const validatedSettings = settingsSchema.parse(body)

    // In a real app, save settings to database
    // For now, just return success

    return NextResponse.json({
      success: true,
      message: "Settings saved successfully",
    })
  } catch (error) {
    console.error("Error saving settings:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid settings data",
          details: error.errors,
        },
        { status: 400 },
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to save settings",
      },
      { status: 500 },
    )
  }
}
