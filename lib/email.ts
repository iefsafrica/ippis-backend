import nodemailer from "nodemailer";
import { withCors, handleOptions } from "@/lib/cors";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_USER = "taiwodele88@gmail.com";
const DEFAULT_SMTP_PASS = "ucbznlbhnbogwuer";

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST || DEFAULT_SMTP_HOST;
  const user = process.env.SMTP_USER || DEFAULT_SMTP_USER;
  const pass = process.env.SMTP_PASS || DEFAULT_SMTP_PASS;
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return { host, user, pass, port, secure };
}

// Create transporter using current env variables dynamically with fallback
export function getTransporter() {
  const { host, user, pass, port, secure } = getSmtpConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

export const transporter = new Proxy({} as nodemailer.Transporter, {
  get(_target, prop) {
    const instance = getTransporter();
    const val = (instance as any)[prop];
    return typeof val === "function" ? val.bind(instance) : val;
  },
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
  // Local development only: print the code so sign-in works without a mailbox.
  // Never in production, where anyone with log access could use it.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[OTP Email] DEV MODE - OTP for ${to}: ${otp}`);
  }

  // Build recipients list: if user.email is an internal @ippis.gov.ng address,
  // also deliver to SMTP_USER so the operator receives it in their mailbox.
  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.log(`[OTP Email] SMTP credentials not set, email skipped. OTP: ${otp}`);
    return null;
  }

  console.log(`[OTP Email] Attempting to send OTP email to: ${recipients.join(", ")}`);

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS Admin" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
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

/**
 * =========================================================================
 * EMPLOYEE CREDENTIALS & ACCOUNT CREATION EMAILS (HTML)
 * =========================================================================
 */

export interface EmployeeCredentialsPayload {
  to: string;
  fullName: string;
  username: string;
  temporaryPassword: string;
  roleName?: string | undefined;
  mdaName?: string | undefined;
  departmentName?: string | undefined;
  staffId?: string | undefined;
  loginUrl?: string | undefined;
}

function generateCredentialsEmailHtml(payload: EmployeeCredentialsPayload): string {
  const {
    to,
    fullName,
    username,
    temporaryPassword,
    roleName,
    mdaName,
    departmentName,
    staffId,
    loginUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app/login",
  } = payload;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your IPPIS Portal Account Login Credentials</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS PORTAL</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Welcome, ${fullName}</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
                An official account has been successfully created for you on the <strong>Integrated Personnel and Payroll Information System (IPPIS)</strong>.
              </p>
              <p style="margin: 0 0 24px; color: #475569; font-size: 15px; line-height: 1.6;">
                Below are your official login credentials to sign in to the portal:
              </p>
              
              <!-- Credentials Card -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #059669; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; line-height: 1.8;">
                  <tr>
                    <td style="color: #64748b; width: 145px; padding: 4px 0; font-weight: 500;">Portal URL:</td>
                    <td style="color: #0f172a; padding: 4px 0;"><a href="${loginUrl}" style="color: #059669; text-decoration: underline; font-weight: 600;">${loginUrl}</a></td>
                  </tr>
                  ${staffId ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Staff / ID No:</td>
                    <td style="color: #0f172a; font-family: monospace; font-size: 15px; font-weight: 700; padding: 4px 0;">${staffId}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Username:</td>
                    <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${username}</td>
                  </tr>
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Email:</td>
                    <td style="color: #0f172a; padding: 4px 0;">${to}</td>
                  </tr>
                  <tr>
                    <td style="color: #64748b; padding: 6px 0; font-weight: 500;">Temporary Password:</td>
                    <td style="padding: 6px 0;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 16px; font-weight: 800; color: #047857; background-color: #d1fae5; padding: 4px 10px; border-radius: 4px; border: 1px solid #a7f3d0; letter-spacing: 0.5px; display: inline-block;">${temporaryPassword}</span>
                    </td>
                  </tr>
                  ${roleName ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Assigned Role:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 4px 0;">${roleName}</td>
                  </tr>` : ''}
                  ${mdaName ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">MDA:</td>
                    <td style="color: #0f172a; padding: 4px 0;">${mdaName}</td>
                  </tr>` : ''}
                  ${departmentName ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Department:</td>
                    <td style="color: #0f172a; padding: 4px 0;">${departmentName}</td>
                  </tr>` : ''}
                </table>
              </div>

              <!-- Button CTA -->
              <div style="text-align: center; margin: 28px 0 24px;">
                <a href="${loginUrl}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(4, 120, 87, 0.3);">
                  Log In to IPPIS Portal &rarr;
                </a>
              </div>

              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fefce8; border-left: 4px solid #eab308; border-radius: 6px; padding: 14px 18px; margin-bottom: 24px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 6px; color: #854d0e; font-size: 13px; font-weight: 700;">
                      &#9888; Mandatory Security Requirement
                    </p>
                    <p style="margin: 0; color: #713f12; font-size: 13px; line-height: 1.5;">
                      For your protection, you are required to change your temporary password immediately upon your first sign-in. Never disclose your login credentials or OTP to any third party.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                If you did not request or expect this account, please immediately contact your MDA Desk Officer or the IPPIS support team.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 11px;">
                This is an automated system notification. Please do not reply directly to this email.
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
 * Sends login credentials to an employee/user upon account creation.
 */
export async function sendEmployeeCredentialsEmail(payload: EmployeeCredentialsPayload) {
  const { to, fullName, username, temporaryPassword, staffId, roleName, loginUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app/login" } = payload;
  console.log(`[Credentials Email] Preparing credentials email for ${fullName} (${to}) with username: ${username}`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Credentials Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  const plainText = `Dear ${fullName},

Your official IPPIS Portal account has been created.

Here are your account credentials:
- Portal URL: ${loginUrl}
${staffId ? `- Staff ID: ${staffId}\n` : ''}- Username: ${username}
- Email: ${to}
- Temporary Password: ${temporaryPassword}
${roleName ? `- Assigned Role: ${roleName}\n` : ''}

SECURITY NOTICE:
You are required to change your temporary password immediately upon your first sign-in. Never share your password or OTP with anyone.

Integrated Personnel and Payroll Information System (IPPIS)
Federal Republic of Nigeria`;

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS HRMS" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Your IPPIS Portal Account Has Been Created - Login Credentials",
      text: plainText,
      html: generateCredentialsEmailHtml(payload),
    });

    console.log(`[Credentials Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Credentials Email] Failed to send email to ${recipients.join(", ")}:`, error);
    // Log error but do not throw unhandled exception to prevent breaking the caller transaction
    return null;
  }
}

/**
 * =========================================================================
 * EMPLOYEE REGISTRATION / ONBOARDING EMAILS (HTML)
 * =========================================================================
 */

export interface EmployeeRegistrationPayload {
  to: string;
  fullName: string;
  registrationId: string;
  position?: string | undefined;
  department?: string | undefined;
  onboardingUrl?: string | undefined;
}

function generateRegistrationEmailHtml(payload: EmployeeRegistrationPayload): string {
  const {
    fullName,
    registrationId,
    position,
    department,
    onboardingUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/register`,
  } = payload;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your IPPIS Employee Registration Details</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS PORTAL</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Welcome, ${fullName}</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
                Your employee profile has been registered on the <strong>Integrated Personnel and Payroll Information System (IPPIS)</strong>.
              </p>
              
              <!-- Registration ID Box -->
              <div style="background-color: #f0fdf4; border: 2px dashed #86efac; border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0;">
                <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #166534; margin-bottom: 8px;">Employee Registration ID</span>
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 26px; font-weight: 800; letter-spacing: 2px; color: #047857; display: inline-block;">${registrationId}</span>
              </div>

              ${(department || position) ? `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-size: 14px; line-height: 1.8;">
                ${position ? `<div><span style="color: #64748b; font-weight: 500;">Position:</span> <strong style="color: #0f172a;">${position}</strong></div>` : ''}
                ${department ? `<div><span style="color: #64748b; font-weight: 500;">Department:</span> <strong style="color: #0f172a;">${department}</strong></div>` : ''}
              </div>` : ''}

              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                <strong>Required Action:</strong> Please log in to the employee registration portal using your Registration ID to upload your mandatory credentials (Letter of First Appointment, Educational Certificates, and verification documents) to complete your onboarding:
              </p>

              <!-- Button CTA -->
              <div style="text-align: center; margin: 28px 0 24px;">
                <a href="${onboardingUrl}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(4, 120, 87, 0.3);">
                  Complete Registration & Upload Documents &rarr;
                </a>
              </div>

              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                Please keep this Registration ID safe. You will need it to track your enrollment and approval status.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
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
 * Sends an employee registration onboarding email with Registration ID.
 */
export async function sendEmployeeRegistrationEmail(payload: EmployeeRegistrationPayload) {
  const { to, fullName, registrationId, onboardingUrl } = payload;
  console.log(`[Registration Email] Sending registration details for ${fullName} (${to})`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Registration Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  const plainText = `Dear ${fullName},

Your employee registration has been received on the IPPIS Portal.

Your Employee Registration ID is:
${registrationId}

Please visit the onboarding link to complete your registration and upload required documents:
${onboardingUrl}

Integrated Personnel and Payroll Information System (IPPIS)
Federal Republic of Nigeria`;

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS HRMS" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Welcome to IPPIS - Employee Registration ID & Onboarding",
      text: plainText,
      html: generateRegistrationEmailHtml(payload),
    });

    console.log(`[Registration Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Registration Email] Failed to send email to ${recipients.join(", ")}:`, error);
    return null;
  }
}

/**
 * =========================================================================
 * EMPLOYEE APPROVAL & OFFICIAL ID NOTIFICATION EMAILS (HTML)
 * =========================================================================
 */

export interface EmployeeApprovalPayload {
  to: string;
  fullName: string;
  employeeId: string;
  position?: string | undefined;
  department?: string | undefined;
  loginUrl?: string | undefined;
  username?: string | undefined;
  temporaryPassword?: string | undefined;
}

function generateApprovalEmailHtml(payload: EmployeeApprovalPayload): string {
  const {
    to,
    fullName,
    employeeId,
    position,
    department,
    username = to,
    temporaryPassword,
    loginUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/login`,
  } = payload;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Official Employment Approval & Login Credentials - IPPIS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS PORTAL</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <div style="background-color: #ecfdf5; border-radius: 6px; padding: 8px 14px; display: inline-block; margin-bottom: 16px;">
                <span style="color: #065f46; font-size: 13px; font-weight: 700;">&#10003; EMPLOYMENT RECORD APPROVED</span>
              </div>
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Congratulations, ${fullName}</h2>
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                Your employment record has been officially approved and activated on the <strong>Integrated Personnel and Payroll Information System (IPPIS)</strong>. Your employee self-service account has been created.
              </p>
              
              <!-- Official Employee ID Box -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #059669; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; line-height: 1.8;">
                  <tr>
                    <td style="color: #64748b; width: 160px; padding: 4px 0; font-weight: 500;">Official Employee ID:</td>
                    <td style="color: #047857; font-family: monospace; font-size: 18px; font-weight: 800; padding: 4px 0;">${employeeId}</td>
                  </tr>
                  ${position ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Position / Rank:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 4px 0;">${position}</td>
                  </tr>` : ''}
                  ${department ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Department / MDA:</td>
                    <td style="color: #0f172a; padding: 4px 0;">${department}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Employment Status:</td>
                    <td style="color: #047857; font-weight: 700; padding: 4px 0;">Active</td>
                  </tr>
                </table>
              </div>

              ${temporaryPassword ? `
              <!-- Login Credentials Card -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #166534;">Your Employee Login Credentials</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; line-height: 1.8;">
                  <tr>
                    <td style="color: #4b5563; width: 160px; padding: 4px 0; font-weight: 500;">Login Portal:</td>
                    <td style="color: #0f172a; padding: 4px 0;"><a href="${loginUrl}" style="color: #059669; text-decoration: underline; font-weight: 600;">${loginUrl}</a></td>
                  </tr>
                  <tr>
                    <td style="color: #4b5563; padding: 4px 0; font-weight: 500;">Username / Email:</td>
                    <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${username || to}</td>
                  </tr>
                  <tr>
                    <td style="color: #4b5563; padding: 6px 0; font-weight: 500;">Temporary Password:</td>
                    <td style="padding: 6px 0;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 16px; font-weight: 800; color: #166534; background-color: #dcfce7; padding: 4px 10px; border-radius: 4px; border: 1px solid #86efac; letter-spacing: 0.5px; display: inline-block;">${temporaryPassword}</span>
                    </td>
                  </tr>
                </table>
                <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #dcfce7;">
                  <span style="color: #854d0e; font-size: 12px; font-weight: 600;">&#9888; Security Requirement:</span>
                  <span style="color: #713f12; font-size: 12px;"> You are required to change your temporary password immediately upon your first sign-in.</span>
                </div>
              </div>` : ''}

              <!-- Button CTA -->
              <div style="text-align: center; margin: 28px 0 24px;">
                <a href="${loginUrl}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(4, 120, 87, 0.3);">
                  Log In to Employee Self-Service &rarr;
                </a>
              </div>

              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                You can now log in to the Employee Self-Service portal to access payslips, leave applications, and HR services.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
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
 * Sends an official employment approval email with official Employee ID.
 */
export async function sendEmployeeApprovalEmail(payload: EmployeeApprovalPayload) {
  const { to, fullName, employeeId } = payload;
  console.log(`[Approval Email] Sending approval notification for ${fullName} (${to})`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Approval Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  const plainText = `Dear ${fullName},

Your employment record has been officially approved and activated on IPPIS.

Your Official Employee ID: ${employeeId}
${payload.username ? `Username: ${payload.username}\n` : ''}${payload.temporaryPassword ? `Temporary Password: ${payload.temporaryPassword}\n` : ''}
Portal URL: ${payload.loginUrl || `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/login`}

SECURITY REQUIREMENT:
You are required to change your temporary password immediately upon your first sign-in. Never share your password or OTP with anyone.

Integrated Personnel and Payroll Information System (IPPIS)
Federal Republic of Nigeria`;

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS HRMS" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Official Employment Record Approved - IPPIS HRMS",
      text: plainText,
      html: generateApprovalEmailHtml(payload),
    });

    console.log(`[Approval Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Approval Email] Failed to send email to ${recipients.join(", ")}:`, error);
    return null;
  }
}

/**
 * =========================================================================
 * EMPLOYEE REJECTION NOTIFICATION EMAILS (HTML)
 * =========================================================================
 */

export interface EmployeeRejectionPayload {
  to: string;
  fullName: string;
  reapplyUrl: string;
  reason?: string | undefined;
}

function generateRejectionEmailHtml(payload: EmployeeRejectionPayload): string {
  const { fullName, reapplyUrl, reason } = payload;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employment Application Status - IPPIS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS PORTAL</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <div style="background-color: #fff1f2; border-radius: 6px; padding: 8px 14px; display: inline-block; margin-bottom: 16px;">
                <span style="color: #be123c; font-size: 13px; font-weight: 700;">APPLICATION STATUS UPDATE</span>
              </div>
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Dear ${fullName},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
                Thank you for your interest and submission to the <strong>Integrated Personnel and Payroll Information System (IPPIS)</strong>.
              </p>
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                After careful review of your registration documents and verification records, we regret to inform you that your application could not be approved at this time.
              </p>
              ${reason ? `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #be123c; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-size: 14px; line-height: 1.6;">
                <div style="color: #64748b; font-weight: 500; margin-bottom: 4px;">Review Feedback:</div>
                <div style="color: #0f172a; font-weight: 500;">${reason}</div>
              </div>` : ''}
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                You are welcome to update your information, correct any document discrepancies, and resubmit for reconsideration using the link below:
              </p>
              <!-- Button CTA -->
              <div style="text-align: center; margin: 28px 0 24px;">
                <a href="${reapplyUrl}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(4, 120, 87, 0.3);">
                  Resubmit Application &rarr;
                </a>
              </div>
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                If you have questions regarding this decision, please reach out to the IPPIS HR desk or your ministry desk officer.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
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
 * Sends an official employment application rejection email with reapply link.
 */
export async function sendEmployeeRejectionEmail(payload: EmployeeRejectionPayload) {
  const { to, fullName, reapplyUrl } = payload;
  console.log(`[Rejection Email] Sending status notice for ${fullName} (${to})`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Rejection Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  const plainText = `Dear ${fullName},

We regret to inform you that your employment application has not been approved at this time.

You are welcome to review and resubmit your details here:
${reapplyUrl}

Integrated Personnel and Payroll Information System (IPPIS)
Federal Republic of Nigeria`;

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS HRMS" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Your IPPIS Employment Application Status",
      text: plainText,
      html: generateRejectionEmailHtml(payload),
    });

    console.log(`[Rejection Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Rejection Email] Failed to send email to ${recipients.join(", ")}:`, error);
    return null;
  }
}


/**
 * =========================================================================
 * PASSWORD RESET REQUEST & CONFIRMATION EMAILS (HTML)
 * Supports both ACTIVE and PENDING employees
 * =========================================================================
 */

export interface PasswordResetEmailPayload {
  to: string;
  fullName: string;
  resetUrl: string;
  token: string;
  employeeId?: string | undefined;
  isPending?: boolean | undefined;
  statusLabel?: string | undefined;
  expiresInMinutes?: number | undefined;
}

export interface PasswordChangedEmailPayload {
  to: string;
  fullName: string;
  loginUrl?: string | undefined;
}

function generatePasswordResetEmailHtml(payload: PasswordResetEmailPayload): string {
  const {
    to,
    fullName,
    resetUrl,
    token,
    employeeId,
    isPending = false,
    statusLabel = isPending ? "Pending Application" : "Active Employee",
    expiresInMinutes = 60,
  } = payload;

  const fullResetLink = resetUrl.includes("?")
    ? `${resetUrl}&token=${token}`
    : `${resetUrl}?token=${token}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Request - IPPIS Portal</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS & SELF-SERVICE</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <div style="background-color: #fef3c7; border-radius: 6px; padding: 8px 14px; display: inline-block; margin-bottom: 16px;">
                <span style="color: #92400e; font-size: 13px; font-weight: 700;">&#128274; PASSWORD RESET REQUEST</span>
              </div>
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Dear ${fullName},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
                We received an official request to reset the password associated with your <strong>Integrated Personnel and Payroll Information System (IPPIS)</strong> account (${to}).
              </p>
              
              <!-- Account Context Card -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #008751; border-radius: 8px; padding: 18px 22px; margin-bottom: 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; line-height: 1.8;">
                  <tr>
                    <td style="color: #64748b; width: 160px; padding: 4px 0; font-weight: 500;">Account Category:</td>
                    <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${statusLabel}</td>
                  </tr>
                  ${employeeId ? `
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">${isPending ? 'Tracking ID:' : 'Employee ID:'}</td>
                    <td style="color: #047857; font-family: monospace; font-size: 16px; font-weight: 800; padding: 4px 0;">${employeeId}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="color: #64748b; padding: 4px 0; font-weight: 500;">Registered Email:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 4px 0;">${to}</td>
                  </tr>
                </table>
              </div>

              <!-- Button CTA -->
              <div style="text-align: center; margin: 28px 0 24px;">
                <a href="${fullResetLink}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 14px 36px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(4, 120, 87, 0.3);">
                  Reset Your Password &rarr;
                </a>
              </div>

              <!-- Expiry Alert -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
                <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.5;">
                  &#9200; <strong>Time-Sensitive:</strong> For your security, this password reset link will expire in <strong>${expiresInMinutes} minutes</strong>. If expired, you may request a new link at any time.
                </p>
              </div>

              <!-- Fallback Direct URL -->
              <p style="margin: 0 0 8px; color: #64748b; font-size: 13px; line-height: 1.6;">
                If the button above does not open, copy and paste this link into your web browser:
              </p>
              <p style="margin: 0 0 24px; color: #0284c7; font-size: 12px; word-break: break-all; font-family: monospace; background-color: #f8fafc; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                ${fullResetLink}
              </p>

              <!-- Security Notice -->
              <div style="border-top: 1px solid #e2e8f0; padding-top: 16px;">
                <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                  <strong>Did not request this change?</strong> If you did not make this request, you can safely disregard this email. Your current password remains secure and active.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
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

function generatePasswordChangedEmailHtml(payload: PasswordChangedEmailPayload): string {
  const {
    to,
    fullName,
    loginUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/login`,
  } = payload;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert: Password Changed - IPPIS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%); padding: 36px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">IPPIS HRMS & SECURITY</h1>
              <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Federal Republic of Nigeria</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <div style="background-color: #ecfdf5; border-radius: 6px; padding: 8px 14px; display: inline-block; margin-bottom: 16px;">
                <span style="color: #065f46; font-size: 13px; font-weight: 700;">&#10003; PASSWORD CHANGED SUCCESSFULLY</span>
              </div>
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 600;">Hello ${fullName},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">
                This is an official security confirmation that the password for your IPPIS portal account (${to}) has been successfully updated.
              </p>
              
              <div style="text-align: center; margin: 24px 0 24px;">
                <a href="${loginUrl}" style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 12px 30px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">
                  Sign In to IPPIS &rarr;
                </a>
              </div>

              <div style="border-top: 1px solid #e2e8f0; padding-top: 16px;">
                <p style="margin: 0; color: #dc2626; font-size: 12px; line-height: 1.5; font-weight: 500;">
                  If you did not authorize this change, please contact the IPPIS Helpdesk and your Ministry System Administrator immediately to lock your account.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 600;">
                Integrated Personnel and Payroll Information System (IPPIS)
              </p>
              <p style="margin: 0 0 6px; color: #94a3b8; font-size: 12px;">
                Office of the Accountant-General of the Federation &bull; Federal Republic of Nigeria
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
 * Sends a password reset email with secure token link to an active or pending employee.
 */
export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload) {
  const { to, fullName, resetUrl, token, expiresInMinutes = 60 } = payload;
  console.log(`[Password Reset Email] Sending reset link to ${fullName} (${to})`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Password Reset Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  const fullResetLink = resetUrl.includes("?")
    ? `${resetUrl}&token=${token}`
    : `${resetUrl}?token=${token}`;

  const plainText = `Dear ${fullName},

We received a request to reset your password on the Integrated Personnel and Payroll Information System (IPPIS).

Reset Link: ${fullResetLink}

This link is valid for ${expiresInMinutes} minutes. If you did not request this, please ignore this email.

Integrated Personnel and Payroll Information System (IPPIS)
Federal Republic of Nigeria`;

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS Security" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Password Reset Request - IPPIS Portal",
      text: plainText,
      html: generatePasswordResetEmailHtml(payload),
    });

    console.log(`[Password Reset Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Password Reset Email] Failed to send to ${recipients.join(", ")}:`, error);
    return null;
  }
}

/**
 * Sends a password changed confirmation email.
 */
export async function sendPasswordChangedEmail(payload: PasswordChangedEmailPayload) {
  const { to, fullName } = payload;
  console.log(`[Password Changed Email] Sending confirmation to ${fullName} (${to})`);

  const recipients = Array.from(
    new Set([
      to,
      ...(to.endsWith("@ippis.gov.ng") ? [process.env.SMTP_USER || "taiwodele88@gmail.com"] : []),
    ])
  ).filter(Boolean);

  const { user: smtpUser, pass: smtpPass } = getSmtpConfig();
  const hasCredentials = Boolean(smtpUser && smtpPass);
  if (!hasCredentials) {
    console.warn(`[Password Changed Email] SMTP credentials not set, email skipped for: ${to}`);
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: `"IPPIS Security" <${process.env.SMTP_USER || "taiwodele88@gmail.com"}>`,
      to: recipients.join(", "),
      subject: "Security Alert: Your IPPIS Password Has Been Changed",
      text: `Hello ${fullName},

This is an official security confirmation that the password for your IPPIS account (${to}) was successfully changed.

If you did not authorize this, please contact IPPIS Helpdesk immediately.

Integrated Personnel and Payroll Information System (IPPIS)`,
      html: generatePasswordChangedEmailHtml(payload),
    });

    console.log(`[Password Changed Email] Sent successfully to ${recipients.join(", ")}. Message ID: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error(`[Password Changed Email] Failed to send to ${recipients.join(", ")}:`, error);
    return null;
  }
}

/**
 * =========================================================================
 * EMPLOYEE SELF-SERVICE PORTAL EMAILS
 * =========================================================================
 */

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
