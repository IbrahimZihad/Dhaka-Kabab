import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { publicTokenSchema } from "@/server/validation/common";
import { getSessionForGuest } from "@/server/services/table.service";
import { getSettings } from "@/server/services/settings.service";
import { guestBill, guestOrder } from "@/server/http/guest-view";

const querySchema = z.object({ participantToken: publicTokenSchema });

export const GET = route(async (request: Request) => {
  const { participantToken } = parseQuery(new URL(request.url).searchParams, querySchema);
  const [participant, settings] = await Promise.all([getSessionForGuest(participantToken), getSettings()]);
  const symbol = settings.currencySymbol;
  const bill = participant.session.bills[0] ?? null;

  return ok({
    session: {
      id: participant.session.id,
      code: participant.session.code,
      table: participant.session.table.label,
      openedAt: participant.session.openedAt.toISOString(),
      billRequestedAt: participant.session.billRequestedAt?.toISOString() ?? null,
      guestCount: participant.session.guestCount,
      status: participant.session.status,
      /** Only this device's own label is echoed back. */
      yourDevice: participant.label,
    },
    orders: participant.session.orders.map((order) => guestOrder(order, symbol)),
    bill: guestBill(bill ?? undefined, symbol),
    currencySymbol: symbol,
  });
});
