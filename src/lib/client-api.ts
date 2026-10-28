/**
 * Browser-side calls to our own API. The envelope is always `{ ok, data }` or
 * `{ ok: false, error: { code, message, details } }`, so a caller gets one shape
 * to branch on and never has to guess whether a non-2xx body is JSON.
 */

export type ApiError = { code?: string; message: string; details?: unknown };

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

export async function apiFetch<T>(pathname: string, init: { method?: string; body?: unknown; form?: URLSearchParams } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = init.form.toString();
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(pathname, { method: init.method ?? "GET", headers, body: payload, credentials: "same-origin" });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "NETWORK", message: "We could not reach the restaurant's servers. Check your connection and try again." },
    };
  }

  const text = await response.text();
  let parsed: { ok?: boolean; data?: T; error?: ApiError } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (response.ok && parsed?.ok) return { ok: true, data: parsed.data as T };

  return {
    ok: false,
    status: response.status,
    error: parsed?.error ?? {
      code: "UNEXPECTED",
      message: response.ok ? "The response could not be read." : `Something went wrong (${response.status}). Please try again.`,
    },
  };
}

export function errorMessage(response: { error: ApiError }): string {
  return response.error.message;
}
