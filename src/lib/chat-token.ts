"use client";

/**
 * The guest assistant's conversation id, kept in localStorage so changing page or
 * closing the panel does not start a fresh chat: the transcript is the thing a
 * staff member may have to read afterwards, and the guest's earlier questions are
 * what make the answer make sense.
 *
 * It is an external store rather than component state because the value only
 * exists in the browser. Reading it in an effect and pushing it into state costs a
 * second render on every mount; `useSyncExternalStore` with a server snapshot of
 * null renders empty first and fills in once the client is there.
 */

const STORAGE_KEY = "dk.chat.token";

const listeners = new Set<() => void>();
let token: string | null = null;
let readFromStorage = false;

function store(next: string | null): void {
  token = next;
  readFromStorage = true;
  if (typeof window !== "undefined") {
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // A blocked storage only costs this guest a new chat on the next reload.
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeChatToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatToken(): string | null {
  if (!readFromStorage && typeof window !== "undefined") {
    try {
      token = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      token = null;
    }
    readFromStorage = true;
  }
  return token;
}

/** Adopted after the server hands back a conversation token for this guest. */
export function setChatToken(next: string): void {
  store(next);
}

/** Used when a conversation is known to be dead and a new one must start. */
export function clearChatToken(): void {
  store(null);
}
