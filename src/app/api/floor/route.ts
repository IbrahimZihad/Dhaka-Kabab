import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { listTables } from "@/server/services/table.service";
import { refreshReservedStatuses } from "@/server/services/reservation.service";
import { getOrderCounters } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { formatPoisa } from "@/lib/money";

/** Floor dashboard snapshot, built for a 2-3 second poll. */
export const GET = route(async (request: Request) => {
  const user = await requireApiPermission(request, "table:view");
  const settings = await getSettings();
  const [tables, counters] = await Promise.all([
    listTables({ includeDisabled: true }),
    getOrderCounters(),
  ]);
  await refreshReservedStatuses();

  const occupied = tables.filter((table) => table.activeSession);
  const outstandingPoisa = occupied.reduce(
    (total, table) => total + (table.activeSession?.outstandingPoisa ?? 0),
    0,
  );

  return ok({
    tables: tables.map((table) => ({
      ...table,
      // The QR token is a floor-plan secret; only roles that print codes see it.
      publicToken: user.role === "OWNER" || user.role === "MANAGER" || user.role === "CASHIER" ? table.publicToken : null,
      activeSession: table.activeSession
        ? {
            ...table.activeSession,
            openedAt: table.activeSession.openedAt.toISOString(),
            bill: table.activeSession.bill
              ? { ...table.activeSession.bill, outstandingLabel: formatPoisa(table.activeSession.outstandingPoisa, { symbol: settings.currencySymbol }) }
              : null,
          }
        : null,
    })),
    summary: {
      total: tables.length,
      occupied: occupied.length,
      available: tables.filter((table) => table.status === "AVAILABLE").length,
      reserved: tables.filter((table) => table.status === "RESERVED").length,
      cleaning: tables.filter((table) => table.status === "CLEANING").length,
      disabled: tables.filter((table) => table.status === "DISABLED").length,
      outstandingPoisa,
      outstandingLabel: formatPoisa(outstandingPoisa, { symbol: settings.currencySymbol }),
      currencySymbol: settings.currencySymbol,
    },
    counters,
  });
});
