import { route, ok, parseBody, clientIp } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { mutationUser, actorOf, requireApiPermission } from "@/server/http/guards";
import { reservationManageSchema } from "@/server/validation/reservation";
import {
  cancelReservation,
  checkInReservation,
  completeReservation,
  confirmReservation,
  markNoShow,
  rescheduleReservation,
} from "@/server/services/reservation.service";
import { prisma } from "@/lib/db";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "reservation:view:any");
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      tables: { include: { table: { select: { label: true, capacity: true } } } },
      sessions: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  return ok(reservation);
});

/**
 * One endpoint for the staff booking actions, dispatched on the requested
 * transition. Each transition has its own service function with its own rules,
 * so this handler decides nothing about state on its own.
 */
export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const input = await parseBody(request, reservationManageSchema);
  const user = await mutationUser(request, "reservation:manage");
  const actor = actorOf(user, clientIp(request));

  if (input.status === "CONFIRMED") return ok(await confirmReservation(id, actor));
  if (input.status === "CHECKED_IN") return ok(await checkInReservation(id, actor));
  if (input.status === "COMPLETED") return ok(await completeReservation(id, actor));
  if (input.status === "NO_SHOW") return ok(await markNoShow(id, actor));
  if (input.status === "CANCELLED") {
    return ok(await cancelReservation(id, input.reason ?? "Cancelled by staff", { ...actor, role: user.role }));
  }
  if (input.status === "PENDING") {
    throw new AppError("VALIDATION", "A booking cannot be moved back to pending.");
  }
  if (!input.dateKey || !input.time) {
    throw new AppError("VALIDATION", "Send a new date and time, or a status to change to.");
  }
  return ok(await rescheduleReservation(id, { dateKey: input.dateKey, time: input.time, partySize: input.partySize }, actor));
});
