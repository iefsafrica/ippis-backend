import crypto from "crypto";

export const WINDOW_MS = 15 * 60 * 1000;

// Requests of any kind from one address to one login endpoint
export const IP_LIMIT = 30;
// Wrong passwords for one account from one address
export const PASSWORD_FAILURE_LIMIT = 5;
// Wrong codes before a code is thrown away and the password is needed again
export const OTP_ATTEMPT_LIMIT = 5;
// Wrong codes for one account across all its codes
export const OTP_ACCOUNT_LIMIT = 10;
// New codes that can be requested for one password sign-in
export const RESEND_LIMIT = 3;
// How long after the password step a new code may still be requested
export const LOGIN_WINDOW_MINUTES = 15;

export function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOTP(otp: string) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export function otpMatches(otp: string, storedHash: string) {
  const given = Buffer.from(hashOTP(otp), "hex");
  const stored = Buffer.from(String(storedHash), "hex");
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

export function isAllowedAdminRole(role: string) {
  const normalizedRole = role.replace(/\s+/g, "").toLowerCase();
  return ["admin", "superadmin"].includes(normalizedRole);
}
