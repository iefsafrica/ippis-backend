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

// Account roles that may use the admin sign-in, compared after removing spaces,
// underscores and hyphens ("Super Admin" -> "superadmin"). What each person can
// then open is decided by their assigned roles and permissions.
// Employees are not on this list: they sign in to the employee portal
// (/api/employee/auth/login) with their own account.
const ADMIN_SIGN_IN_ROLES = new Set([
  "admin",
  "superadmin",
  "applicant",
  "centralaccessadmin",
  "centralhradmin",
  "centralpayrolladmin",
  "mdaadmin",
  "departmenthead",
  "hrofficer",
  "payrollofficer",
  "financeofficer",
  "internalauditor",
  "reportingofficer",
  "helpdeskofficer",
  "viewer",
  "officer",
  "user",
]);

export function isAllowedAdminRole(role: string) {
  const normalizedRole = (role || "").replace(/[\s_-]+/g, "").toLowerCase();
  // Exact match: a substring test let any role containing "user" or "admin" through
  return ADMIN_SIGN_IN_ROLES.has(normalizedRole);
}

