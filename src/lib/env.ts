/**
 * Server-side environment access. Values are read lazily so unit tests and CLI
 * scripts can set them before first use. Nothing here is safe to import from a
 * client component except `publicEnv`.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function integer(name: string, fallback: number): number {
  const value = optional(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(name: string, fallback = false): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get testDatabaseUrl() {
    return optional("TEST_DATABASE_URL");
  },
  get appUrl(): string {
    return (optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get authSecret(): string {
    const secret = optional("AUTH_SECRET");
    if (!secret) {
      throw new Error(
        "AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.",
      );
    }
    if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
    return secret;
  },
  get sessionMaxAgeSeconds(): number {
    return integer("SESSION_MAX_AGE_SECONDS", 60 * 60 * 12);
  },
  get pollIntervalMs(): number {
    return Math.max(1000, integer("NEXT_PUBLIC_REALTIME_POLL_INTERVAL_MS", 2500));
  },
  get uploadDir(): string {
    return optional("UPLOAD_DIR") ?? "./storage/uploads";
  },

  // --- Payment provider -----------------------------------------------------
  get sslcommerz(): { storeId: string; apiKey: string; mode: "sandbox" | "live"; baseUrl: string } | null {
    const storeId = optional("SSLCOMMERZ_STORE_ID");
    const apiKey = optional("SSLCOMMERZ_API_KEY");
    if (!storeId || !apiKey) return null;
    const mode = optional("SSLCOMMERZ_MODE") === "live" ? "live" : "sandbox";
    return {
      storeId,
      apiKey,
      mode,
      baseUrl:
        optional("SSLCOMMERZ_BASE_URL") ??
        (mode === "live" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com"),
    };
  },

  // --- AI provider ----------------------------------------------------------
  get ai(): { provider: string; baseUrl: string; model: string; apiKey: string } | null {
    const apiKey = optional("AI_API_KEY") ?? optional("OPENAI_API_KEY");
    const model = optional("AI_MODEL") ?? optional("OPENAI_MODEL");
    if (!apiKey || !model) return null;
    return {
      provider: optional("AI_PROVIDER") ?? "openai",
      baseUrl: (optional("AI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      model,
      apiKey,
    };
  },
  get aiMaxOutputTokens(): number {
    return integer("AI_MAX_OUTPUT_TOKENS", 400);
  },
  get aiTimeoutMs(): number {
    return integer("AI_REQUEST_TIMEOUT_MS", 20_000);
  },

  // --- Email ----------------------------------------------------------------
  get smtp() {
    const host = optional("SMTP_HOST");
    if (!host) return null;
    return {
      host,
      port: integer("SMTP_PORT", 587),
      secure: flag("SMTP_SECURE", false),
      user: optional("SMTP_USER"),
      pass: optional("SMTP_PASS"),
      from: optional("MAIL_FROM"),
    };
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get isTest(): boolean {
    return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  },
};

/** Values that are safe to inline in the browser bundle. */
export const publicEnv = {
  appUrl: env.appUrl,
  pollIntervalMs: env.pollIntervalMs,
};
