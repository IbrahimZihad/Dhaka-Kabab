import { route, ok, parseQuery } from "@/lib/api";
import { reservationAvailabilitySchema } from "@/server/validation/reservation";
import { getAvailability } from "@/server/services/reservation.service";

/**
 * Public slot check. It reports what the database can prove is free and names
 * the reason for everything else; it never implies a slot is being held.
 */
export const GET = route(async (request: Request) => {
  const query = parseQuery(new URL(request.url).searchParams, reservationAvailabilitySchema);
  const availability = await getAvailability(query.dateKey, query.partySize);
  return ok(availability);
});
