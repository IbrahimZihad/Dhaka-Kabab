import { route, ok } from "@/lib/api";
import { getReservationByToken } from "@/server/services/reservation.service";

/** Guest view of one booking, reachable only through its own unguessable token. */
export const GET = route(async (_request: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const reservation = await getReservationByToken(token);
  return ok({
    code: reservation.code,
    status: reservation.status,
    customerName: reservation.customerName,
    partySize: reservation.partySize,
    startsAt: reservation.startsAt.toISOString(),
    durationMinutes: reservation.durationMinutes,
    tables: reservation.tables.map((assignment) => assignment.table.label),
    specialRequests: reservation.specialRequests,
    canChange: ["PENDING", "CONFIRMED"].includes(reservation.status),
  });
});
