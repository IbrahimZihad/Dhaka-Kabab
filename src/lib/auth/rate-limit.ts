import { AppError } from "@/lib/errors";

/**
 * Fixed-window limiter kept in process memory.
 *
 * Scope: protects login, registration, chat and public order creation on the
 * single Node process a restaurant of this size runs on. On a multi-instance
 * deployment each instance keeps its own window, so the effective ceiling scales
 * with instance count; move this map to a shared store before scaling out.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, value] of windows) {
    if (value.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = { limit: number; remaining: number; resetAfterSeconds: number };

export function rateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const id = `${bucket}:${key}`;
  const current = windows.get(id);

  if (!current || current.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { limit, remaining: limit - 1, resetAfterSeconds: windowSeconds };
  }

  current.count += 1;
  const resetAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
  if (current.count > limit) {
    const error = new AppError(
      "RATE_LIMITED",
      `Too many attempts. Try again in ${resetAfterSeconds} seconds.`,
    );
    throw error;
  }
  return { limit, remaining: limit - current.count, resetAfterSeconds };
}

export function resetRateLimits(): void {
  windows.clear();
}

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  reservation: { limit: 8, windowSeconds: 600 },
  order: { limit: 30, windowSeconds: 300 },
  chat: { limit: 20, windowSeconds: 60 },
} as const;
