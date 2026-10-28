import { createHash, randomBytes } from "node:crypto";

/**
 * Unpredictable, URL-safe public identifiers. Sequential database ids never
 * appear in a QR link, a receipt URL or a chat payload.
 */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes)
    .toString("base64url")
    .replace(/[_-]/g, (c) => (c === "-" ? "a" : "b"));
}

/** Short, human-readable code a guest can quote on the phone. */
export function randomShortCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Deterministic fingerprint of a gateway callback body, used to spot duplicates. */
export function payloadFingerprint(payload: unknown): string {
  const normalized =
    typeof payload === "string" ? payload : JSON.stringify(payload, Object.keys(payload ?? {}).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/** Slug for menu items and categories. Non-ASCII input falls back to the name hash. */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return base === "" ? `item-${randomToken(4)}` : base.slice(0, 72);
}
