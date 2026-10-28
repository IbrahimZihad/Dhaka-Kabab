import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { RESERVATION_STATUS_LABELS, SESSION_STATUS_LABELS, TABLE_STATUS_LABELS } from "@/lib/staff-format";
import { addMinutes, formatInZone, todayKey, zonedParts } from "@/lib/time";
import { listTables } from "@/server/services/table.service";
import { getSettings } from "@/server/services/settings.service";
import { orUnset } from "@/server/http/site";
import { Details, Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { createdViaLabel } from "@/components/admin/reservation-list";
import { ReservationStatusActions, type ReservationStep } from "@/components/admin/reservation-status-actions";
import { ReservationTableAssign } from "@/components/admin/reservation-table-assign";
import { ReservationRescheduleForm } from "@/components/admin/reservation-reschedule-form";

export const metadata: Metadata = { title: "Booking" };

/**
 * The steps offered for a booking, mirroring the reservation service exactly:
 * RESERVATION_TRANSITIONS plus the service's own check-in rule (a confirmed or
 * still-pending party may be marked arrived). COMPLETED, CANCELLED and NO_SHOW
 * are terminal, so nothing is offered for them. Cancellation carries its own
 * required reason inside the actions component.
 */
function stepsFor(status: keyof typeof RESERVATION_STATUS_LABELS): ReservationStep[] {
  switch (status) {
    case "PENDING":
      return [
        { status: "CONFIRMED", label: "Confirm" },
        { status: "CHECKED_IN", label: "Seat — mark arrived" },
        { status: "NO_SHOW", label: "Mark as no-show" },
        { status: "CANCELLED", label: "Cancel" },
      ];
    case "CONFIRMED":
      return [
        { status: "CHECKED_IN", label: "Seat — mark arrived" },
        { status: "NO_SHOW", label: "Mark as no-show" },
        { status: "CANCELLED", label: "Cancel" },
      ];
    case "CHECKED_IN":
      return [
        { status: "COMPLETED", label: "Complete the visit" },
        { status: "CANCELLED", label: "Cancel" },
      ];
    default:
      return [];
  }
}

const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"] as const;

/** One read, typed: the booking with its tables, its visits and any linked account. */
async function readReservation(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    include: {
      tables: {
        include: { table: { select: { id: true, label: true, capacity: true, status: true, isEnabled: true } } },
        orderBy: { table: { number: "asc" } },
      },
      sessions: {
        orderBy: { openedAt: "desc" },
        include: { table: { select: { label: true } } },
      },
      customer: { select: { id: true, name: true, email: true } },
    },
  });
}

function ReservationSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-6 w-48" />
      <span className="skeleton block h-10 w-64" />
      <div className="grid gap-6 lg:grid-cols-2">
        <span className="skeleton block h-56" />
        <span className="skeleton block h-56" />
      </div>
      <span className="skeleton block h-40" />
    </div>
  );
}

async function ReservationDetailBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "reservation:view:any")) {
    return (
      <Panel title="One booking" description="This section belongs to the roles that run the room.">
        <p className="text-sm soft">
          Your screen is the{" "}
          <Link href="/kitchen" className="underline">
            kitchen display
          </Link>
          , where orders arrive as guests send them.
        </p>
      </Panel>
    );
  }

  const mayManage = roleHasPermission(user.role, "reservation:manage");

  let failure: string | null = null;
  let reservation: Awaited<ReturnType<typeof readReservation>> | null = null;
  let tables: Awaited<ReturnType<typeof listTables>> = [];
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;

  try {
    [reservation, tables, settings] = await Promise.all([readReservation(id), listTables({ includeDisabled: true }), getSettings()]);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    failure = error instanceof AppError ? error.message : "This booking could not be read.";
  }

  if (failure) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Booking</h1>
        <Note kind="error">
          {failure} Nothing was changed.{" "}
          <Link href="/admin/reservations" className="underline">
            Back to the bookings list
          </Link>
          .
        </Note>
      </div>
    );
  }

  if (!reservation || !settings) notFound();

  const timeZone = settings.timezone;
  const startsAt = reservation.startsAt;
  const endsAt = addMinutes(startsAt, reservation.durationMinutes);
  const status = reservation.status;
  const terminal = (TERMINAL as readonly string[]).includes(status);
  const primaryTable = reservation.tables[0]?.table ?? null;
  const floorHref = primaryTable
    ? `/admin/floor?search=${encodeURIComponent(primaryTable.label)}`
    : "/admin/floor";

  const guestLink = `/reserve/confirm?token=${encodeURIComponent(reservation.publicToken)}`;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Guest", value: reservation.customerName },
    { label: "Phone", value: reservation.phone },
    { label: "Email", value: orUnset(reservation.email) },
    { label: "Party", value: `${reservation.partySize} guest${reservation.partySize === 1 ? "" : "s"}` },
    { label: "Arrival", value: formatInZone(startsAt, timeZone) },
    { label: "Held until", value: formatInZone(endsAt, timeZone) },
    { label: "Sitting length", value: `${reservation.durationMinutes} minutes` },
    { label: "Source", value: createdViaLabel(reservation.createdVia) },
    { label: "Policy accepted", value: reservation.policyAccepted ? "Yes — recorded" : "No" },
    { label: "Special requests", value: orUnset(reservation.specialRequests) },
    { label: "Requested on", value: formatInZone(reservation.createdAt, timeZone) },
  ];
  if (reservation.customer) {
    rows.push({ label: "Guest account", value: `${reservation.customer.name} (${reservation.customer.email})` });
  }

  const events: { label: string; at: Date | null }[] = [
    { label: "Confirmed", at: reservation.confirmedAt },
    { label: "Marked arrived", at: reservation.checkedInAt },
    { label: "Completed", at: reservation.completedAt },
    { label: "Cancelled", at: reservation.cancelledAt },
    { label: "Marked as no-show", at: reservation.noShowAt },
  ].filter((event) => event.at !== null);

  const steps = mayManage ? stepsFor(status) : [];
  const dayKey = zonedParts(startsAt, timeZone).dateKey;

  return (
    <div className="space-y-6">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/admin/reservations" className="hover:text-brand">
          Bookings
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{reservation.code}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {reservation.customerName}
            <span className="ml-2 font-mono text-xl muted">{reservation.code}</span>
          </h1>
          <p className="hint mt-1">
            {reservation.partySize} guest{reservation.partySize === 1 ? "" : "s"} · arrives{" "}
            {formatInZone(startsAt, timeZone)} · held for {reservation.durationMinutes} minutes ·{" "}
            {primaryTable ? `table ${primaryTable.label}` : "no table allocated yet"}
            {reservation.isDemo ? " · sample booking" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={RESERVATION_STATUS_LABELS[status]} />
          <Link href={`/admin/reservations?dateKey=${dayKey}`} className="btn btn-ghost btn-sm">
            That day&apos;s list
          </Link>
        </div>
      </div>

      {status === "CANCELLED" && reservation.cancelReason ? (
        <Note kind="error">Cancelled: {reservation.cancelReason}</Note>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="The booking" description="Stored facts only — anything never recorded says so.">
          <Details rows={rows} />
          {events.length > 0 ? (
            <ol className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
              {events.map((event) => (
                <li key={event.label} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="label">{event.label}</span>
                  <span className="muted">{formatInZone(event.at as Date, timeZone)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint mt-3">No further steps have been recorded on this booking.</p>
          )}
        </Panel>

        <Panel title="Tables" description="As the booking service assigned them; overlaps are its decision, not this page's.">
          {reservation.tables.length === 0 ? (
            <p className="hint">No table has been allocated to this booking yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {reservation.tables.map((assignment) => (
                <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    <Link href={floorHref} className="font-semibold hover:text-brand">
                      {assignment.table.label}
                    </Link>{" "}
                    <span className="muted">— seats {assignment.table.capacity}</span>
                  </span>
                  <StatusBadge
                    status={
                      TABLE_STATUS_LABELS[
                        assignment.table.status as keyof typeof TABLE_STATUS_LABELS
                      ] ?? assignment.table.status
                    }
                  />
                  {!assignment.table.isEnabled ? <span className="muted">out of service</span> : null}
                </li>
              ))}
            </ul>
          )}
          {reservation.tables.length > 0 ? (
            <p className="hint mt-3">
              On the floor: <Link href={floorHref} className="underline">open the board at this table</Link>.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel title="The guest's own link" description="The token below is the booking's credential — quote it only to the guest it belongs to.">
        <Details
          rows={[
            {
              label: "Link",
              value: (
                <Link href={guestLink} className="underline break-all" target="_blank" rel="noreferrer">
                  {guestLink}
                </Link>
              ),
            },
            { label: "Token", value: <span className="font-mono">{reservation.publicToken}</span> },
          ]}
        />
        <p className="hint mt-3">
          From this link the guest sees the booking and may cancel it — the lookup endpoint accepts no other proof of
          identity, so staff never need to invent one.
        </p>
      </Panel>

      <Panel title="Table sessions" description="Live or past visits opened under this booking.">
        {reservation.sessions.length === 0 ? (
          <p className="hint">
            No table session yet — seating the booking (or the floor board) opens one, and the bill then belongs to
            that visit.
          </p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {reservation.sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono font-semibold">{session.code}</span>{" "}
                  <span className="muted">
                    · table {session.table.label} · opened {formatInZone(session.openedAt, timeZone)}
                    {session.closedAt ? ` · closed ${formatInZone(session.closedAt, timeZone)}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={SESSION_STATUS_LABELS[session.status as keyof typeof SESSION_STATUS_LABELS] ?? session.status}
                  />
                  <Link href={`/admin/floor?search=${encodeURIComponent(session.table.label)}`} className="btn btn-ghost btn-sm">
                    Floor board
                  </Link>
                  <Link
                    href={`/admin/orders?sessionId=${encodeURIComponent(session.id)}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Its orders
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {mayManage ? (
        <>
          <Panel title="Move this booking" description="Each step is re-checked by the service when you press it; nothing here claims success before the server answers.">
            <ReservationStatusActions
              reservationId={reservation.id}
              code={reservation.code}
              steps={steps}
              floorHref={floorHref}
            />
          </Panel>

          {!terminal ? (
            <Panel
              title="Reassign tables"
              description="The chosen tables are re-checked against every overlapping booking in a locked transaction before the change lands."
            >
              <ReservationTableAssign
                reservationId={reservation.id}
                code={reservation.code}
                partySize={reservation.partySize}
                assignedIds={reservation.tables.map((assignment) => assignment.table.id)}
                tables={tables.map((table) => ({
                  id: table.id,
                  label: table.label,
                  capacity: table.capacity,
                  status: table.status,
                  isEnabled: table.isEnabled,
                }))}
              />
            </Panel>
          ) : null}

          {["PENDING", "CONFIRMED"].includes(status) ? (
            <Panel
              title="Change the time"
              description="Only a booking awaiting arrival can be moved; the availability grid and the clash rules are the server's."
            >
              <ReservationRescheduleForm
                reservationId={reservation.id}
                code={reservation.code}
                initialDateKey={dayKey}
                initialTime={zonedParts(startsAt, timeZone).time}
                initialPartySize={reservation.partySize}
                todayKey={todayKey(timeZone)}
                maxDaysAhead={settings.reservationMaxDaysAhead}
              />
            </Panel>
          ) : null}
        </>
      ) : (
        <p className="hint">
          Changing, seating or reassigning a booking needs the bookings permission, which this role does not carry;
          this page is read-only for you.
        </p>
      )}
    </div>
  );
}

export default function AdminReservationDetailPage(props: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<ReservationSkeleton />}>
      <ReservationDetailBody params={props.params} />
    </Suspense>
  );
}
