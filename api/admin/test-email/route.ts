import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import nodemailer from "nodemailer"

// Define schema for email test validation
const emailTestSchema = z.object({
  email: z.string().email("Invalid email address"),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate email test data
    const validatedData = emailTestSchema.parse(body)

    // Get email configuration from environment variables
    const emailServer = process.env.EMAIL_SERVER
    const emailPort = process.env.EMAIL_PORT
    const emailUser = process.env.EMAIL_USER
    const emailPass = process.env.EMAIL_PASS
    const emailFrom = process.env.EMAIL_FROM

    // Check if email configuration is available
    if (!emailServer || !emailPort || !emailUser || !emailPass || !emailFrom) {
      return NextResponse.json(
        {
          success: false,
          error: "Email configuration is incomplete. Please check your environment variables.",
          missingVars: {
            emailServer: !emailServer,
            emailPort: !emailPort,
            emailUser: !emailUser,
            emailPass: !emailPass,
            emailFrom: !emailFrom,
          },
        },
        { status: 400 },
      )
    }

    // Create a test transporter
    const transporter = nodemailer.createTransport({
      host: emailServer,
      port: Number.parseInt(emailPort),
      secure: Number.parseInt(emailPort) === 465,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    })

    // Verify the connection
    await transporter.verify()

    // Send a test email
    const info = await transporter.sendMail({
      from: emailFrom,
      to: validatedData.email,
      subject: "IPPIS Email Configuration Test",
      text: "This is a test email to verify that your IPPIS email configuration is working correctly.",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #333;">IPPIS Email Configuration Test</h2>
          <p>This is a test email to verify that your IPPIS email configuration is working correctly.</p>
          <p>If you received this email, your email configuration is working properly.</p>
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="color: #666; font-size: 12px;">This is an automated message from the IPPIS Admin Portal.</p>
          </div>
        </div>
      `,
    })

    return NextResponse.json({
      success: true,
      message: "Test email sent successfully",
      messageId: info.messageId,
      details: {
        to: validatedData.email,
        from: emailFrom,
        subject: "IPPIS Email Configuration Test",
      },
    })
  } catch (error) {
    console.error("Error sending test email:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email address",
          details: error.errors,
        },
        { status: 400 },
      )
    }

    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : "Failed to send test email"

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}
