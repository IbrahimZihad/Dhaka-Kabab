import bcrypt from "bcryptjs";

const ROUNDS = 11;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Deliberately weak-password gate for the seeding and staff-creation paths.
 * Rules are ours (a restaurant is not a bank), and the message tells the
 * operator exactly what to change instead of failing silently.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "Mix upper and lower case letters.";
  if (!/\d/.test(password)) return "Include at least one digit.";
  if (/^(password|123456|qwerty|dhaka|kabab)/i.test(password)) return "Do not start with a common word.";
  return null;
}
