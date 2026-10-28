import { NextResponse, connection } from "next/server";
import type { ZodTypeAny, z } from "zod";
import { AppError, isAppError, toPublicError } from "@/lib/errors";
import { env } from "@/lib/env";

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
export type RouteOptions = {
  /**
   * The session cookie is `SameSite=Lax` and every mutation reads a JSON body, so a
   * cross-site form post already arrives unauthenticated. This flag skips the
   * belt-and-braces origin check for the one kind of write that legitimately comes
   * from another site — an external gateway posting a customer back to us.
   */
  allowForeignOrigin?: boolean;
};

export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  options: RouteOptions = {},
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    // Cache Components bails a prerender out of by *throwing* when a handler reads request-time
    // data, and every JSON endpoint here is request-time: session cookie, Origin header, caller
    // IP, row writes. So this says so up front — and it sits deliberately *outside* the `try`
    // below, because a `catch` that swallows the bail-out turns Next's own signal into a 500 and
    // prints a stack per route during `next build`.
    await connection();
    try {
      const first = args[0];
      if (!options.allowForeignOrigin && first instanceof Request) {
        const method = first.method.toUpperCase();
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") assertSameOrigin(first);
      }
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
 * =Lax, which already blocks cross-site POSTs; this makes the requirement
 * explicit and covers non-browser clients with an Origin header.
 *
 * The comparison is deliberately not `Origin === new URL(request.url).origin`:
 * that value is the server's own view of the request, which in `next dev` is
 * always `localhost` whatever the browser used, and behind a reverse proxy is the
 * internal host. Both would reject a legitimate customer whose Origin is the real
 * public origin, so the allowed set is the request URL, the configured
 * `NEXT_PUBLIC_APP_URL`, and the localhost/127.0.0.1 aliases of each.
 */
export function allowedOrigins(request: Request): string[] {
  const candidates = [safeOrigin(request.url), env.appUrl];
  const allowed: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!allowed.includes(candidate)) allowed.push(candidate);
    const localAlias = aliasOfLocalOrigin(candidate);
    if (localAlias && !allowed.includes(localAlias)) allowed.push(localAlias);
  }
  return allowed;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `http://localhost:3000` ⇄ `http://127.0.0.1:3000`; anything else has no alias. */
function aliasOfLocalOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost") return new URL(origin.replace("localhost", "127.0.0.1")).origin;
    if (parsed.hostname === "127.0.0.1") return new URL(origin.replace("127.0.0.1", "localhost")).origin;
    return null;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const normalised = origin.replace(/\/+$/, "");
  if (allowedOrigins(request).includes(normalised)) return;
  throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
}

/**
 * The address the app is willing to act on.
 *
 * `X-Forwarded-For` is a list the *client* starts: whoever sends the request writes
 * the leftmost entry, so reading it first hands every IP-keyed limit and every audit
 * row to the caller — a spammer needs only a different fake address per request. The
 * entries a deployment's own proxies append are the trustworthy ones, and there are
 * exactly `TRUSTED_PROXY_HOPS` of them, counted from the right.
 *
 * With no hops declared the process is exposed directly, and Node gives a route
 * handler no access to the socket address, so the honest answer is "unknown": a
 * coarse shared ceiling is better than a per-client limit that is really per-request.
 */
export function clientIp(request: Request): string {
  const hops = env.trustedProxyHops;
  if (hops <= 0) return "unknown";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
    // Shorter than the declared hops means somebody trimmed the list before it
    // reached us, so nothing in it can be attributed to a proxy.
    const index = chain.length - hops;
    if (index >= 0) return chain[index]!;
    return "unknown";
  }

  // A single proxy that rewrites the address itself, rather than appending to a list.
  return hops === 1 ? (request.headers.get("x-real-ip") ?? "unknown") : "unknown";
}

/** Coarse pagination so a bad client cannot ask for the whole table. */
export function paginate(input: { page?: number; pageSize?: number }, defaults = { pageSize: 25, max: 200 }) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(defaults.max, Math.max(1, input.pageSize ?? defaults.pageSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
