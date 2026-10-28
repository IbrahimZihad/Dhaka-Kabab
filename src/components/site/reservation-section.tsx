import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getReservationByToken } from "@/server/services/reservation.service";
import { getSettings } from "@/server/services/settings.service";
import { ReservationPanel } from "@/components/site/reservation-panel";

/**
 * Loads one booking through its token. A wrong or expired link is a 404, not a
 * form error: this page must not confirm whether a given code exists.
 */
export async function ReservationSection({ token }: { token: string }) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(token)) notFound();

  let reservation;
  try {
    reservation = await getReservationByToken(token);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const settings = await getSettings();

  return (
    <ReservationPanel
      token={token}
      view={{
        code: reservation.code,
        status: reservation.status,
        customerName: reservation.customerName,
        partySize: reservation.partySize,
        startsAt: reservation.startsAt.toISOString(),
        durationMinutes: reservation.durationMinutes,
        tables: reservation.tables.map((assignment) => assignment.table.label),
        specialRequests: reservation.specialRequests,
        canChange: ["PENDING", "CONFIRMED"].includes(reservation.status),
        timeZone: settings.timezone,
      }}
    />
  );
}
