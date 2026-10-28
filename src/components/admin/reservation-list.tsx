import Link from "next/link";
import { RESERVATION_STATUS_LABELS } from "@/lib/staff-format";
import { formatInZone } from "@/lib/time";
import { listReservations } from "@/server/services/reservation.service";
import { AdminTable, StatusBadge } from "@/components/admin/admin-ui";

/**
 * One booking exactly as the reservation service read it — the stored columns
 * only. Nothing on this row is calculated in the browser; availability and
 * clashes are the server's business.
 */
export type ReservationRow = Awaited<ReturnType<typeof listReservations>>["reservations"][number];

/**
 * The booking's own record of where the request came from. The create endpoint
 * stores WEB for anonymous guests and ACCOUNT for any signed-in user, so the
 * two are reported as stored, never guessed at.
 */
export function createdViaLabel(createdVia: string): string {
  if (createdVia === "WEB") return "Website";
  if (createdVia === "ACCOUNT") return "Signed-in account";
  return createdVia;
}

export function tableLabels(reservation: Pick<ReservationRow, "tables">): string {
  return reservation.tables.map((assignment) => assignment.table.label).join(", ");
}

export function ReservationList({ reservations, timeZone }: { reservations: ReservationRow[]; timeZone: string }) {
  return (
    <AdminTable head={["Booking", "Guest", "Party", "Arrival", "Tables", "Status", "Source", "Open"]}>
      {reservations.map((reservation) => (
        <tr key={reservation.id} className="border-b border-line align-top">
          <td className="px-3 py-2">
            <Link href={`/admin/reservations/${reservation.id}`} className="font-mono font-semibold hover:text-brand">
              {reservation.code}
            </Link>
            {reservation.isDemo ? <span className="badge ml-2">sample</span> : null}
          </td>
          <td className="px-3 py-2">
            <p className="font-semibold">{reservation.customerName}</p>
            <p className="muted">{reservation.phone}</p>
          </td>
          <td className="px-3 py-2 tabular-nums soft">
            {reservation.partySize} guest{reservation.partySize === 1 ? "" : "s"}
          </td>
          <td className="px-3 py-2 whitespace-nowrap soft">{formatInZone(reservation.startsAt, timeZone)}</td>
          <td className="px-3 py-2 soft">
            {reservation.tables.length > 0 ? tableLabels(reservation) : "Not allocated yet"}
          </td>
          <td className="px-3 py-2">
            <StatusBadge status={RESERVATION_STATUS_LABELS[reservation.status]} />
          </td>
          <td className="px-3 py-2 soft">{createdViaLabel(reservation.createdVia)}</td>
          <td className="px-3 py-2">
            <Link href={`/admin/reservations/${reservation.id}`} className="btn btn-ghost btn-sm">
              Open
            </Link>
          </td>
        </tr>
      ))}
    </AdminTable>
  );
}
