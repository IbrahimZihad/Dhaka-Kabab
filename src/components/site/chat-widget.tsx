"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/client-api";
import { getChatToken, setChatToken, subscribeChatToken } from "@/lib/chat-token";

type Source = { kind: string; label: string };
type ChatReply = {
  conversationToken: string;
  reply: string;
  answeredBy: string;
  usedFallback: boolean;
  notice: string | null;
  model: string | null;
  sources: Source[];
  suggestions: string[];
};
type Message = { role: "user" | "assistant"; content: string; answeredBy?: string; notice?: string | null; sources?: Source[] };

const STARTERS = ["What kababs do you have?", "What time do you close?", "Can I book a table for six?", "Do you deliver?"];

/**
 * The guest assistant. Every answer is built from the restaurant's own records,
 * and the widget says in plain words when it had to fall back or hand over to a
 * person — a guess is never presented as a fact.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const token = useSyncExternalStore(subscribeChatToken, getChatToken, () => null);
  const endRef = useRef<HTMLDivElement | null>(null);

  /**
   * On the table's ordering page the question can be about this visit, so the
   * table token already in the address is passed along. It is read after mount
   * because the server never sees the browser's URL bar.
   */
  const tableToken = useRef<string | null>(null);

  useEffect(() => {
    tableToken.current = new URL(window.location.href).searchParams.get("table");
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setDraft("");
    const history = messages.slice(-6).map((message) => ({ role: message.role, content: message.content }));
    setMessages((current) => [...current, { role: "user", content: question }]);
    setBusy(true);

    const response = await apiFetch<ChatReply>("/api/chat", {
      method: "POST",
      body: {
        message: question,
        history,
        ...(token ? { conversationToken: token } : {}),
        ...(tableToken.current ? { tableToken: tableToken.current } : {}),
      },
    });

    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      setMessages((current) => [...current.slice(0, -1)]);
      return;
    }

    setChatToken(response.data.conversationToken);
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: response.data.reply,
        answeredBy: response.data.answeredBy,
        notice: response.data.notice,
        sources: response.data.sources,
      },
    ]);
  }

  async function escalate() {
    if (!token) return;
    setBusy(true);
    const response = await apiFetch<{ message: string }>("/api/chat/escalate", { method: "POST", body: { conversationToken: token } });
    setBusy(false);
    if (response.ok) {
      setEscalated(true);
      setMessages((current) => [...current, { role: "assistant", content: response.data.message }]);
    } else {
      setError(response.error.message);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary fixed bottom-4 right-4 shadow-lg">
        Ask us something
      </button>
    );
  }

  return (
    <section aria-label="Questions about the restaurant" className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden card shadow-xl">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="text-sm font-bold">Ask the restaurant</p>
        <p className="hint ml-auto">Answers come from our own menu and settings.</p>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm" aria-label="Close the assistant">
          Close
        </button>
      </header>

      <div className="max-h-[50vh] space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm soft">Ask about dishes and prices, opening hours, payments, or booking a table.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" onClick={() => send(starter)} className="badge hover:border-brand hover:text-brand">
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "text-right" : ""}>
            <div className={message.role === "user" ? "inline-block max-w-[85%] rounded-xl bg-brand px-3 py-2 text-sm text-white" : "notice text-left whitespace-pre-line"}>
              {message.content}
            </div>
            {message.role === "assistant" && message.notice ? <p className="hint mt-1">{message.notice}</p> : null}
            {message.role === "assistant" && message.sources?.length ? (
              <p className="hint mt-1">
                From: {message.sources.map((source) => source.label).join(", ")} · {message.answeredBy}
              </p>
            ) : null}
          </div>
        ))}

        {busy ? <p className="hint">Thinking…</p> : null}
        {error ? <p className="notice notice-error mt-2">{error}</p> : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-3 py-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <input
            className="input"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 600))}
            placeholder="Type your question"
            aria-label="Your question"
            maxLength={600}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || draft.trim().length < 2}>
            Send
          </button>
        </form>
        {token && !escalated ? (
          <button type="button" onClick={escalate} className="btn btn-ghost btn-sm mt-2" disabled={busy}>
            Speak to a person instead
          </button>
        ) : null}
      </div>
    </section>
  );
}
