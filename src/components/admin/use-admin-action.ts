"use client";

import { useState } from "react";
import { apiFetch, type ApiError } from "@/lib/client-api";

/**
 * One place for the three things every staff action has to report: it is still
 * running, it went wrong, or it worked. A failure is shown as the message the
 * server sent; nothing here claims success before the response arrives.
 */
export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", pathname: string, body?: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await apiFetch<T & { message?: string }>(pathname, { method, body });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message || fallbackFor(response.error));
      return null;
    }
    return response.data;
  }

  return {
    busy,
    error,
    notice,
    setNotice,
    setError,
    run,
    async dismiss(message?: string) {
      setNotice(message ?? null);
      setError(null);
    },
  };
}

function fallbackFor(error: ApiError): string {
  if (error.code === "FORBIDDEN") return "Your role is not allowed to do this.";
  if (error.code === "UNAUTHORIZED") return "Your session ended. Please sign in again.";
  return "The server refused that change. Nothing was saved.";
}
