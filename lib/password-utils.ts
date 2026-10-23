import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * Generates a cryptographically random hexadecimal password reset token (64 characters).
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validates password meets statutory security complexity requirements:
 * - Minimum 8 characters
 * - Must contain at least one uppercase letter, one lowercase letter, and one number
 */
export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required." };
  }
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter (A-Z)." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter (a-z)." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number (0-9)." };
  }
  return { valid: true };
}

/**
 * A random one-off password for a new account, sent to the user by email.
 * 14 characters from an unambiguous alphabet, always including upper case,
 * lower case and a digit, so it passes validatePasswordStrength.
 */
export function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)]!;
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 14) chars.push(pick(all));
  // Fisher-Yates shuffle so the guaranteed characters are not always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
