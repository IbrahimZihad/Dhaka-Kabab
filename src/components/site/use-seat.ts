"use client";

import { useSyncExternalStore } from "react";
import { getSeat, isSeatHydrated, subscribeSeat, type TableSeat } from "@/lib/table-seat";

/** React window onto the stored table seat; null until localStorage is read. */
export function useSeat(): TableSeat | null {
  return useSyncExternalStore(subscribeSeat, getSeat, () => null);
}

/** False on the server and on the first client paint, true once storage is read. */
export function useSeatHydrated(): boolean {
  return useSyncExternalStore(subscribeSeat, isSeatHydrated, () => false);
}
