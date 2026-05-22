import nodemailer from "nodemailer";
import { withCors, handleOptions } from "@/lib/cors";

// Create transporter using env variables
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true", // false for 587, true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Sends an OTP email to the specified recipient.
 * Provides detailed logs for debugging SMTP issues.
 * @param to Recipient email address
 * @param otp OTP code
 */
export async function sendOTPEmail(to: string, otp: string) {
  console.log(`[OTP Email] Attempting to send OTP to: ${to}`);

  try {
    // Verify SMTP connection before sending
    await transporter.verify();
    console.log("[OTP Email] SMTP connection verified");

    const info = await transporter.sendMail({
      from: `"IPPIS Admin" <${process.env.SMTP_USER}>`,
      to,
      subject: "Your Admin OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center;">
          <h2>Admin Login Verification</h2>
          <p>Your OTP is:</p>
          <h1 style="letter-spacing: 5px;">${otp}</h1>
          <p>This OTP will expire in 5 minutes.</p>
        </div>
      `,
    });

    console.log(`[OTP Email] OTP sent successfully to ${to}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[OTP Email] Failed to send OTP to ${to}`);
    if (error.code === "EAUTH") {
      console.error("[OTP Email] SMTP authentication failed. Check your username/app password.");
    }
    console.error("[OTP Email] Error details:", error);
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}
