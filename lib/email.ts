import nodemailer from "nodemailer";
import { withCors, handleOptions } from "@/lib/cors";

// Create transporter using env variables with robust timeouts
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true", // false for 587, true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 8000, // 8 seconds connection timeout
  greetingTimeout: 8000,   // 8 seconds greeting timeout
  socketTimeout: 10000,    // 10 seconds socket timeout
});

function generateOTPEmailHtml(otp: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your IPPIS Admin Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Admin Sign-In Verification</h2>
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                A sign-in request was initiated for your administrator account on the IPPIS Portal. Use the one-time verification code (OTP) below to complete your login:
              </p>
              
              <!-- OTP Box -->
              <div style="background: #f0fdf4; border: 2px dashed #86efac; border-radius: 10px; padding: 24px; text-align: center; margin: 28px 0;">
                <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #166534; margin-bottom: 8px;">Your One-Time Code</span>
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #047857; display: inline-block;">${otp}</span>
              </div>

              <!-- Expiry & Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fefce8; border-left: 4px solid #eab308; border-radius: 4px; padding: 12px 16px; margin-bottom: 24px;">
                <tr>
                  <td style="color: #713f12; font-size: 13px; line-height: 1.5;">
                    &#9201; This verification code is valid for <strong>5 minutes</strong>. If expired, request a new code from the sign-in screen.
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; color: #64748b; font-size: 13px; line-height: 1.5;">
                &#128274; <strong>Security Warning:</strong> Never share this code with anyone. IPPIS administrators and support personnel will never request your OTP.
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                If you did not attempt to sign in, please contact security support immediately and change your account password.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 500;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                This is an automated security notice. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends an OTP email to the specified recipient.
 * Provides detailed logs for debugging SMTP issues.
 * @param to Recipient email address
 * @param otp OTP code
 */
export async function sendOTPEmail(to: string, otp: string) {
  // Always log OTP for administrative access and audit trail
  console.log(`[OTP Email] Generated OTP for ${to}: ${otp}`);

  // Build recipients list: if user.email is an internal @ippis.gov.ng address,
  // also deliver to SMTP_USER so the operator receives it in their mailbox.
  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") && process.env.SMTP_USER ? [process.env.SMTP_USER] : []),
    ])
  ).filter(Boolean);

  const hasCredentials = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!hasCredentials) {
    console.log(`[OTP Email] SMTP credentials not set, email skipped. OTP: ${otp}`);
    return null;
  }

  console.log(`[OTP Email] Attempting to send OTP email to: ${recipients.join(", ")}`);

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS Admin" <${process.env.SMTP_USER}>`,
      to: recipients.join(", "),
      subject: "Your IPPIS Admin Verification Code",
      text: `IPPIS HRMS - Admin Login Verification\n\nYour One-Time Verification Code (OTP): ${otp}\n\nThis code is valid for 5 minutes.\nFor your security, never share this code with anyone.\n\nIntegrated Personnel and Payroll Information System (IPPIS)\nFederal Republic of Nigeria`,
      html: generateOTPEmailHtml(otp),
    });

    console.log(`[OTP Email] OTP sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[OTP Email] Failed to send OTP to ${recipients.join(", ")}`);
    if (error.code === "EAUTH") {
      console.error("[OTP Email] SMTP authentication failed. Check your username/app password.");
    }
    console.error("[OTP Email] Error details:", error);
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}
