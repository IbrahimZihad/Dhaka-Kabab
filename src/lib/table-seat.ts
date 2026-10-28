"use client";

/**
 * Which table this device is sitting at. The QR link carries an unguessable
 * table token; joining hands back a participant token that is this device's
 * seat. Both live in localStorage so a page reload does not start a second
 * seating, and clearing them is what "leave the table" means here.
 */

const STORAGE_KEY = "dk.table.v1";

export type TableSeat = {
  tableToken: string;
  participantToken: string;
  tableLabel: string;
  sessionCode: string;
};

const listeners = new Set<() => void>();
let seat: TableSeat | null = null;
let hydrated = false;

function emit() {
  for (const listener of listeners) listener();
  if (!hydrated || typeof window === "undefined") return;
  try {
    if (seat) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seat));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked localStorage only costs the guest a re-scan.
  }
}

export function subscribeSeat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSeat(): TableSeat | null {
  return seat;
}

/**
 * Whether localStorage has been read yet. Listeners are told the moment it has,
 * so a component can wait for that instead of guessing with a delayed timer.
 */
export function isSeatHydrated(): boolean {
  return hydrated;
}

export function hydrateSeat(): void {
  if (typeof window === "undefined" || hydrated) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TableSeat) : null;
    seat = parsed && typeof parsed.participantToken === "string" ? parsed : null;
  } catch {
    seat = null;
  }
  hydrated = true;
  emit();
}

export function setSeat(next: TableSeat): void {
  seat = next;
  emit();
}

export function clearSeat(): void {
  seat = null;
  emit();
}
