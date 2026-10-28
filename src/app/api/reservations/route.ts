import { route, ok, created, parseBody, parseQuery, clientIp, assertSameOrigin, paginate } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { assertPermission } from "@/lib/auth/rbac";
import { reservationCreateSchema, reservationListQuerySchema } from "@/server/validation/reservation";
import { createReservation, listReservations } from "@/server/services/reservation.service";
import { getSettings } from "@/server/services/settings.service";
import { dayRange, todayKey } from "@/lib/time";

/**
 * A booking made from the website is a guest action, so it is rate limited and
 * requires policy acceptance rather than an account. Staff bookings run through
 * the same service, so both paths obey identical availability rules.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, reservationCreateSchema);
  const ip = clientIp(request);
  rateLimit("reservation", ip, RATE_LIMITS.reservation.limit, RATE_LIMITS.reservation.windowSeconds);

  const user = await getCurrentUserFromRequest(request);
  if (user && user.role !== "CUSTOMER") assertPermission(user, "reservation:manage");

  const reservation = await createReservation(input, {
    ip,
    createdVia: user ? "ACCOUNT" : "WEB",
    customerId: user?.role === "CUSTOMER" ? user.id : null,
  });

  return created({
    code: reservation.code,
    publicToken: reservation.publicToken,
    startsAt: reservation.startsAt.toISOString(),
    partySize: reservation.partySize,
    tables: reservation.tables.map((assignment) => assignment.table?.label ?? null).filter(Boolean),
    status: reservation.status,
    confirmationUrl: `/reserve/confirm?token=${encodeURIComponent(reservation.publicToken)}`,
    message: "Your booking request is recorded. A confirmation follows once a manager approves it.",
  });
});

export const GET = route(async (request: Request) => {
  const user = await getCurrentUserFromRequest(request);
  assertPermission(user, "reservation:view:any");

  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, reservationListQuerySchema);
  const settings = await getSettings();
  const { page, pageSize, skip, take } = paginate({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 50),
  });

  if (!query.dateKey && !query.status && !query.search) {
    throw new AppError("VALIDATION", "Filter bookings by date, status or a search term.");
  }

  // A date filter bounds the listing to that calendar day; a status or search
  // listing is unbounded in time but capped by pagination.
  const dayKey = query.dateKey ?? todayKey(settings.timezone);
  const window = dayRange(dayKey, settings.timezone);
  const from = query.dateKey ? window.start : undefined;
  const to = query.dateKey ? window.end : undefined;

  const { reservations, total } = await listReservations(
    { from, to, status: query.status, search: query.search },
    { skip, take },
  );
  return ok({ reservations, dateKey: dayKey }, { meta: { page, pageSize, total } });
});
