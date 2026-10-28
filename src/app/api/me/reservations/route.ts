import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { apiCustomer } from "@/server/http/guards";
import { myReservations } from "@/server/services/customer.service";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** The caller's own bookings, each carrying the confirmation link it was made with. */
export const GET = route(async (request: Request) => {
  const user = await apiCustomer(request);
  const { limit } = parseQuery(new URL(request.url).searchParams, querySchema);
  const reservations = await myReservations(user.id, limit);
  return ok({
    reservations: reservations.map((reservation) => ({
      ...reservation,
      manageUrl: `/reserve/${reservation.publicToken}`,
    })),
  });
});
