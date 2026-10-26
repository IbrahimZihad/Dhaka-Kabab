import { NextResponse } from "next/server";
import type { ZodTypeAny, z } from "zod";
import { AppError, isAppError, toPublicError } from "@/lib/errors";

/**
 * One response envelope for every route handler:
 *   success -> { ok: true, data, meta? }
 *   failure -> { ok: false, error: { code, message, details? } }
 */

export type ApiMeta = { page?: number; pageSize?: number; total?: number; [key: string]: unknown };

export function ok<T>(data: T, init?: { status?: number; meta?: ApiMeta; headers?: Record<string, string> }) {
  return NextResponse.json(
    { ok: true, data, ...(init?.meta ? { meta: init.meta } : {}) },
    { status: init?.status ?? 200, headers: init?.headers },
  );
}

export function created<T>(data: T, meta?: ApiMeta) {
  return ok(data, { status: 201, meta });
}

export function fail(error: unknown) {
  const publicError = toPublicError(error);
  return NextResponse.json(
    {
      ok: false,
      error: isAppError(error)
        ? { code: publicError.code, message: publicError.message, details: error.details }
        : { code: publicError.code, message: publicError.message },
    },
    { status: publicError.status },
  );
}

/** Wraps a handler so thrown AppErrors become structured responses. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return fail(error);
    }
  };
}

export async function parseBody<T extends ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      details[key] = [...(details[key] ?? []), issue.message];
    }
    throw new AppError("VALIDATION", "The submitted data is not valid.", details);
  }
  return parsed.data as z.infer<T>;
}

export function parseQuery<T extends ZodTypeAny>(searchParams: URLSearchParams, schema: T): z.infer<T> {
  const plain: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    plain[key] = value;
  });
  const parsed = schema.safeParse(plain);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Invalid query parameters.", {
      query: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return parsed.data as z.infer<T>;
}

/**
 * Same-origin check for state-changing requests. Session cookies are SameSite
 *=Lax, which already blocks cross-site POSTs; this makes the requirement
 * explicit and covers non-browser clients with an Origin header.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Coarse pagination so a bad client cannot ask for the whole table. */
export function paginate(input: { page?: number; pageSize?: number }, defaults = { pageSize: 25, max: 200 }) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(defaults.max, Math.max(1, input.pageSize ?? defaults.pageSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
