import { env } from "@/lib/env";

/**
 * Minimal OpenAI-compatible chat client. One rule: a reply is only ever
 * returned when the provider answered. Any failure — no key, timeout, non-2xx,
 * malformed JSON, empty content — comes back as `{ ok: false, reason }` so the
 * caller can tell the visitor the truth instead of inventing an answer.
 */

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmResult =
  | { ok: true; text: string; model: string; promptTokens: number | null; completionTokens: number | null }
  | { ok: false; reason: string; status?: number };

export function aiProviderStatus(): { configured: boolean; model: string | null; baseUrl: string | null; reason: string | null } {
  const ai = env.ai;
  if (!ai) {
    return {
      configured: false,
      model: null,
      baseUrl: null,
      reason: "AI_API_KEY (or OPENAI_API_KEY) and AI_MODEL are not set, so the assistant answers from the menu and settings only.",
    };
  }
  return { configured: true, model: ai.model, baseUrl: ai.baseUrl, reason: null };
}

export async function completeChat(
  messages: LlmMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<LlmResult> {
  const ai = env.ai;
  if (!ai) return { ok: false, reason: "no-provider" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);
  try {
    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? env.aiMaxOutputTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The provider's error body can echo the request; keep only the status.
      return { ok: false, reason: `http-${response.status}`, status: response.status };
    }

    const payload = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    } | null;

    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, reason: "empty-response" };

    return {
      ok: true,
      text: text.slice(0, 2000),
      model: payload?.model ?? ai.model,
      promptTokens: payload?.usage?.prompt_tokens ?? null,
      completionTokens: payload?.usage?.completion_tokens ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}
