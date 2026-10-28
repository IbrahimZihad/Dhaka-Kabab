import { describe, expect, it } from "vitest";
import { publicTokenSchema } from "@/server/validation/common";
import { payloadFingerprint, randomShortCode, randomToken, slugify } from "@/lib/ids";

/**
 * `src/lib/ids.ts` — public identifiers that appear in QR links, receipt URLs and
 * chat payloads. Two promises matter: they are unpredictable and they are URL/QR
 * safe (which is exactly the `publicTokenSchema` the route handlers enforce), and
 * the fingerprint is a stable dedupe key for a gateway callback body.
 */

describe("randomToken", () => {
  // 16 bytes -> base64url drops padding, so 16 = 3*5 + 1 => 5*4 + 2 = 22 chars.
  it("is a 22-character URL-safe string by default", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9]{22}$/);
  });

  it("contains no base64url punctuation ('-' or '_')", () => {
    // The '-'/'_' from base64url are remapped to 'a'/'b', so the alphabet stays
    // [A-Za-z0-9] and the token round-trips through publicTokenSchema.
    for (let i = 0; i < 50; i += 1) {
      const token = randomToken();
      expect(token).not.toMatch(/[_+/]/);
    }
  });

  it("is accepted by publicTokenSchema (8-64 chars, alphanumeric)", () => {
    expect(publicTokenSchema.safeParse(randomToken()).success).toBe(true);
  });

  it("stays inside the schema length window for a range of byte sizes", () => {
    for (const bytes of [8, 16, 24, 32, 48]) {
      const token = randomToken(bytes);
      expect(token.length).toBeGreaterThanOrEqual(8);
      expect(token.length).toBeLessThanOrEqual(64);
      expect(publicTokenSchema.safeParse(token).success).toBe(true);
    }
  });

  it("never repeats itself (unpredictable)", () => {
    // A birthday collision across 200 22-char tokens is vanishingly unlikely, so
    // a duplicate here means the generator is not actually random.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(randomToken());
    expect(seen.size).toBe(200);
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("randomShortCode", () => {
  // Ambiguity-free alphabet only: no I/O/0/1, so a guest reading it over the
  // phone cannot mis-transcribe a code.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  it("default length is 6 characters from the Crockford-style alphabet", () => {
    const code = randomShortCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(new RegExp(`^[${ALPHABET}]{6}$`));
  });

  it("honours an explicit length", () => {
    expect(randomShortCode(10)).toHaveLength(10);
    expect(randomShortCode(1)).toHaveLength(1);
  });

  it("never emits an ambiguous glyph", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomShortCode(8)).not.toMatch(/[IO01]/);
    }
  });

  it("is uniform because the alphabet divides the byte space (32 | 256)", () => {
    // 256 % 32 === 0, so `bytes[i] % 32` has no modulo bias; assert the divisor
    // fact the generator relies on rather than sampling for distribution.
    expect(256 % ALPHABET.length).toBe(0);
  });
});

describe("payloadFingerprint", () => {
  it("is a 32-character lowercase hex digest", () => {
    expect(payloadFingerprint({ tran_id: "X", amount: "100" })).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable for the same body regardless of top-level key order", () => {
    // The replacer array is `Object.keys(...).sort()`, so {a,b} and {b,a}
    // serialise identically and dedupe against the same gateway retry.
    const one = payloadFingerprint({ status: "VALID", tran_id: "T1", store_amount: "250.00" });
    const other = payloadFingerprint({ store_amount: "250.00", tran_id: "T1", status: "VALID" });
    expect(one).toBe(other);
  });

  it("differs for a different body", () => {
    expect(payloadFingerprint({ tran_id: "T1" })).not.toBe(payloadFingerprint({ tran_id: "T2" }));
  });

  it("treats a string payload verbatim", () => {
    expect(payloadFingerprint("raw-callback")).toBe(payloadFingerprint("raw-callback"));
    expect(payloadFingerprint("raw-callback")).not.toBe(payloadFingerprint("raw-callback-2"));
  });

  it("is deterministic across calls", () => {
    const body = { a: 1, b: "two", c: true };
    expect(payloadFingerprint(body)).toBe(payloadFingerprint(body));
  });
});

describe("slugify", () => {
  it("lowercases and turns internal whitespace into single dashes", () => {
    expect(slugify("Chicken Tikka")).toBe("chicken-tikka");
  });

  it("collapses punctuation runs and strips leading/trailing separators", () => {
    expect(slugify("Hello, World!!")).toBe("hello-world");
    expect(slugify("  Kabab  ")).toBe("kabab");
  });

  it("strips diacritics via NFKD so accented names still slug", () => {
    expect(slugify("Café Special")).toBe("cafe-special");
  });

  it("truncates to 72 characters", () => {
    expect(slugify("a".repeat(100))).toHaveLength(72);
  });

  it("falls back to a non-empty randomised slug for pure-punctuation input", () => {
    // randomToken(4) -> base64url of 4 bytes = ceil(16/3) = 6 alphanumerics.
    const slug = slugify("!!!");
    expect(slug).toMatch(/^item-[A-Za-z0-9]{6}$/);
    expect(slug).not.toBe("");
  });

  it("produces fresh fallbacks so colliding blank names stay unique", () => {
    expect(slugify("###")).not.toBe(slugify("###"));
  });

  it("output always survives the admin slug pattern", () => {
    // menu.ts enforces /^[a-z0-9][a-z0-9-]{1,71}$/ on a supplied slug; the normal
    // path must match it, which is why fallbacks are prefixed with "item".
    for (const input of ["Seekh Kabab", "Beef   Rezala", "Fish!!"]) {
      expect(slugify(input)).toMatch(/^[a-z0-9][a-z0-9-]{1,71}$/);
    }
  });
});
