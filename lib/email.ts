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
  // Local development only: print the OTP instead of emailing it.
  // `next build` / `next start` always run with NODE_ENV=production, so deployed servers never log it.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[OTP Email] DEV MODE - email not sent. OTP for ${to}: ${otp}`);
    return null;
  }

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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Sends an employee portal link (invite or password reset).
 * In local development the link is printed instead, like the OTP above.
 */
async function sendEmployeeLinkEmail(to: string, subject: string, heading: string, intro: string, link: string, validity: string) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[Employee Email] DEV MODE - email not sent. ${subject} for ${to}: ${link}`);
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS HR" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px;">
          <h2>${escapeHtml(heading)}</h2>
          <p>${escapeHtml(intro)}</p>
          <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#0a7d3b;color:#fff;text-decoration:none;border-radius:4px;">Set your password</a></p>
          <p style="color:#555;font-size:13px;">This link ${escapeHtml(validity)} and can be used once. If you did not expect this email, ignore it.</p>
        </div>
      `,
    });
    console.log(`[Employee Email] ${subject} sent to ${to}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Employee Email] Failed to send ${subject} to ${to}:`, error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

export function sendEmployeeInviteEmail(to: string, name: string, link: string) {
  return sendEmployeeLinkEmail(
    to,
    "Your IPPIS employee portal invitation",
    `Welcome, ${name}`,
    "HR has given you access to the IPPIS employee portal. Choose a password to activate your account.",
    link,
    "is valid for 48 hours"
  );
}

export function sendEmployeePasswordResetEmail(to: string, name: string, link: string) {
  return sendEmployeeLinkEmail(
    to,
    "Reset your IPPIS employee portal password",
    `Hello, ${name}`,
    "We received a request to reset your employee portal password.",
    link,
    "is valid for 1 hour"
  );
}

/** A copy of a portal notification, for employees who asked for email. */
export async function sendEmployeeNotificationEmail(to: string, name: string, title: string, message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[Employee Email] DEV MODE - email not sent. Notification for ${to}: ${title} - ${message}`);
    return null;
  }
  const info = await transporter.sendMail({
    from: `"IPPIS HR" <${process.env.SMTP_USER}>`,
    to,
    subject: title,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px;">
        <p>Hello ${escapeHtml(name)},</p>
        <p>${escapeHtml(message)}</p>
        <p style="color:#555;font-size:13px;">You can change which emails you receive under Notification preferences in the employee portal.</p>
      </div>
    `,
  });
  return info;
}
