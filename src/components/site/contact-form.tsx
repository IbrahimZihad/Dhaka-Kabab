"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client-api";

/**
 * A message that reaches a person. It rides the same two steps the chat widget
 * uses — record the question, then flag it for staff — so the contact page and
 * the assistant cannot end up in different inboxes. The confirmation only
 * appears when both calls actually succeeded.
 */
export function ContactForm({ restaurantName }: { restaurantName: string }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Please tell us who is writing.");
    if (message.trim().length < 10) return setError("A little more detail helps us answer properly.");

    setBusy(true);
    setError(null);
    setSent(null);

    const text = `${message.trim()}\n\n— ${name.trim()}${contact.trim() ? ` (${contact.trim()})` : ""}`;
    const asked = await apiFetch<{ conversationToken: string }>("/api/chat", {
      method: "POST",
      body: { message: text.slice(0, 600) },
    });
    if (!asked.ok) {
      setBusy(false);
      setError(asked.error.message);
      return;
    }

    const escalated = await apiFetch<{ message: string }>("/api/chat/escalate", {
      method: "POST",
      body: { conversationToken: asked.data.conversationToken, reason: `Contact form from ${name.trim()}`.slice(0, 300) },
    });
    setBusy(false);

    if (!escalated.ok) {
      // The question is recorded even if the flag failed; say exactly that.
      setError(`We have your message, but could not flag it for a manager: ${escalated.error.message}`);
      return;
    }

    setSent("Thank you — your message is in the team's inbox. They will reply on the number or address you gave.");
    setName("");
    setContact("");
    setMessage("");
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ct-name">
            Your name
          </label>
          <input id="ct-name" className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="ct-contact">
            Number or email (so we can reply)
          </label>
          <input id="ct-contact" className="input mt-1" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ct-message">
          What would you like to ask {restaurantName}?
        </label>
        <textarea id="ct-message" className="textarea mt-1" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={600} />
        <p className="hint mt-1">
          For anything about a live table, the assistant in the corner is quicker — it can see the menu and your
          session.
        </p>
      </div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {sent ? <p className="notice notice-ok">{sent}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Send to the team"}
      </button>
    </form>
  );
}
