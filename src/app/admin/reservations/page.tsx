import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { RESERVATION_STATUS_LABELS } from "@/lib/staff-format";
import { paginate } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { dayRange, todayKey } from "@/lib/time";
import { listReservations } from "@/server/services/reservation.service";
import { getSettings } from "@/server/services/settings.service";
import { EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";
import { ReservationList } from "@/components/admin/reservation-list";
import { ReservationCreateForm } from "@/components/admin/reservation-create-form";

export const metadata: Metadata = { title: "Bookings" };

type StatusKey = keyof typeof RESERVATION_STATUS_LABELS;

/** Everything the address bar can carry, so a view survives reload and can be shared. */
const FILTER_KEYS = ["status", "search", "dateKey", "from", "to", "page", "pageSize"] as const;

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

function oneStatus(value: string | undefined): StatusKey | undefined {
  if (!value) return undefined;
  return Object.prototype.hasOwnProperty.call(RESERVATION_STATUS_LABELS, value) ? (value as StatusKey) : undefined;
}

/** A day the restaurant's clock can bound. Nonsense is refused, never guessed at. */
function validDateKey(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? undefined : value;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "The bookings could not be read.";
}

function BookingsSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <span className="skeleton block h-48" />
      <span className="skeleton block h-72" />
    </div>
  );
}

async function BookingsBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "reservation:view:any")) {
    return (
      <Panel title="Bookings" description="This section belongs to the roles that run the room.">
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

  const raw = await searchParams;
  const status = oneStatus(single(raw, "status"));
  const search = single(raw, "search")?.slice(0, 60);
  const askedDateKey = single(raw, "dateKey");
  const dateKeyFilter = validDateKey(askedDateKey);
  const askedFrom = single(raw, "from");
  const askedTo = single(raw, "to");
  const fromKey = validDateKey(askedFrom);
  const toKey = validDateKey(askedTo);
  const ignoredDays =
    [askedDateKey, askedFrom, askedTo].filter(
      (asked) => asked !== undefined && validDateKey(asked) === undefined,
    ) ?? [];
  const { page, pageSize, skip, take } = paginate({
    page: positiveInt(single(raw, "page")),
    pageSize: positiveInt(single(raw, "pageSize")),
  });

  const settings = await getSettings();
  const timeZone = settings.timezone;
  // Same contract as the endpoint: a day on the restaurant's own clock. A day
  // left unchosen means their today; from/to widen the board to a range.
  const today = todayKey(timeZone);
  const rangeStart = fromKey ?? toKey;
  const rangeEnd = toKey ?? fromKey;
  const listDateKey = rangeStart ?? dateKeyFilter ?? today;
  const covering = rangeStart ? dayRange(rangeStart, timeZone) : dayRange(listDateKey, timeZone);
  const window = {
    start: covering.start,
    end: rangeEnd && rangeEnd !== rangeStart ? dayRange(rangeEnd, timeZone).end : covering.end,
  };
  const rangeLabel = rangeStart
    ? rangeEnd && rangeEnd !== rangeStart
      ? `${rangeStart} to ${rangeEnd}`
      : rangeStart
    : listDateKey;

  const current: Record<string, string | undefined> = {
    status,
    search,
    dateKey: dateKeyFilter,
    from: fromKey,
    to: toKey,
    page: page > 1 ? String(page) : undefined,
    // Only named when it differs from the default page size, so a shared
    // address stays short.
    pageSize: pageSize !== paginate({}).pageSize ? String(pageSize) : undefined,
  };

  /** Rebuilds the list address with one or two values changed; null removes one. */
  function hrefFor(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const override = overrides[key];
      const value = override === undefined ? current[key] : override;
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/admin/reservations?${query}` : "/admin/reservations";
  }

  const active: { key: string; label: string; value: string }[] = [];
  if (status) active.push({ key: "status", label: "Status", value: RESERVATION_STATUS_LABELS[status] });
  if (search) active.push({ key: "search", label: "Search", value: search });
  if (dateKeyFilter) active.push({ key: "dateKey", label: "Day", value: dateKeyFilter });
  if (fromKey) active.push({ key: "from", label: "From", value: fromKey });
  if (toKey) active.push({ key: "to", label: "To", value: toKey });

  let failure: string | null = null;
  let reservations: Awaited<ReturnType<typeof listReservations>>["reservations"] = [];
  let total = 0;
  let tiles: { arrivals: number; awaiting: number; arrived: number; noShows: number } | null = null;

  const todayWindow = dayRange(today, timeZone);
  try {
    const [listed, arrivals, awaiting, arrived, noShows] = await Promise.all([
      listReservations({ from: window.start, to: window.end, status, search }, { skip, take }),
      listReservations({ from: todayWindow.start, to: todayWindow.end }, { skip: 0, take: 1 }),
      listReservations({ from: todayWindow.start, to: todayWindow.end, status: "PENDING" }, { skip: 0, take: 1 }),
      listReservations({ from: todayWindow.start, to: todayWindow.end, status: "CHECKED_IN" }, { skip: 0, take: 1 }),
      listReservations({ from: todayWindow.start, to: todayWindow.end, status: "NO_SHOW" }, { skip: 0, take: 1 }),
    ]);
    reservations = listed.reservations;
    total = listed.total;
    tiles = { arrivals: arrivals.total, awaiting: awaiting.total, arrived: arrived.total, noShows: noShows.total };
  } catch (error) {
    failure = describeFailure(error);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="hint mt-1">
            {listDateKey === today && !rangeStart
              ? `Arrivals on ${listDateKey} — the restaurant's own day, in ${timeZone}.`
              : `Arrivals on ${rangeLabel}, on the restaurant's clock (${timeZone}).`}{" "}
            Times and tables come from the service; nothing here is guessed.
          </p>
        </div>
        <Link href="/admin/reservations" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      <Panel title="Find bookings" description="Filters live in the address, so a view survives a reload or can be shared.">
        <form method="get" action="/admin/reservations" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="reservations-search">
              Guest name, phone or booking code
            </label>
            <input
              id="reservations-search"
              type="search"
              name="search"
              defaultValue={search ?? ""}
              maxLength={60}
              placeholder="BK-… / Rahim / 01712…"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="label" htmlFor="reservations-status">
              Status
            </label>
            <select id="reservations-status" name="status" defaultValue={status ?? ""} className="select mt-1">
              <option value="">Any status</option>
              {(Object.keys(RESERVATION_STATUS_LABELS) as StatusKey[]).map((key) => (
                <option key={key} value={key}>
                  {RESERVATION_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reservations-date">
              Day
            </label>
            <input id="reservations-date" type="date" name="dateKey" defaultValue={dateKeyFilter ?? ""} className="input mt-1" />
            <p className="hint mt-1">Left empty, the list shows the restaurant&apos;s today.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="reservations-from">
                From (day)
              </label>
              <input id="reservations-from" type="date" name="from" defaultValue={fromKey ?? ""} className="input mt-1" />
            </div>
            <div>
              <label className="label" htmlFor="reservations-to">
                To (day)
              </label>
              <input id="reservations-to" type="date" name="to" defaultValue={toKey ?? ""} className="input mt-1" />
            </div>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn btn-outline btn-sm">
              Show bookings
            </button>
            <span className="hint ml-3">
              A From/To pair widens the arrivals board over several days and takes precedence over the single Day.
            </span>
          </div>
        </form>

        {active.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="label">Active filters</span>
            {active.map((filter) => (
              <Link key={filter.key} href={hrefFor({ [filter.key]: null, page: null })} className="badge">
                {filter.label}: {filter.value} — clear
              </Link>
            ))}
          </div>
        ) : (
          <p className="hint mt-4">
            No filters applied. Search matches the booking code, the guest&apos;s name, or the digits of their number.
          </p>
        )}

        {ignoredDays.length > 0 ? (
          <p className="notice notice-error mt-4">
            “{ignoredDays.join("”, “")}” {ignoredDays.length === 1 ? "is" : "are"} not a day we can read, so today is
            shown instead. Dates are written YYYY-MM-DD.
          </p>
        ) : null}
      </Panel>

      {tiles ? (
        <Panel title="Today's arrivals" description={`Counted on the restaurant's own day (${today}), by the booking service.`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href={hrefFor({ status: null, dateKey: today, from: null, to: null, page: null })} className="block">
              <Stat label="Arrivals today" value={tiles.arrivals} hint="Bookings starting today, any status" />
            </Link>
            <Link
              href={hrefFor({ status: "PENDING", dateKey: today, from: null, to: null, page: null })}
              className="block"
            >
              <Stat label={RESERVATION_STATUS_LABELS.PENDING} value={tiles.awaiting} hint="Needs a confirmation" />
            </Link>
            <Link
              href={hrefFor({ status: "CHECKED_IN", dateKey: today, from: null, to: null, page: null })}
              className="block"
            >
              <Stat label={RESERVATION_STATUS_LABELS.CHECKED_IN} value={tiles.arrived} hint="Seated today" />
            </Link>
            <Link
              href={hrefFor({ status: "NO_SHOW", dateKey: today, from: null, to: null, page: null })}
              className="block"
            >
              <Stat label={RESERVATION_STATUS_LABELS.NO_SHOW} value={tiles.noShows} hint="Released as absent today" />
            </Link>
          </div>
        </Panel>
      ) : null}

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the bookings are where they were.{" "}
          <Link href="/admin/reservations" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : (
        <>
          {mayManage ? (
            <Panel
              title="Take a booking"
              description="Sent through the same endpoint and availability rules as a guest booking, so nothing here can slip past a clash."
            >
              <ReservationCreateForm
                todayKey={today}
                maxDaysAhead={settings.reservationMaxDaysAhead}
                durationMinutes={settings.reservationDurationMinutes}
              />
            </Panel>
          ) : (
            <p className="hint">
              Taking or changing a booking needs the bookings permission, which this role does not carry; the list
              below is read-only for you.
            </p>
          )}

          <Panel
            title={active.length > 0 ? "Matching bookings" : `Bookings on ${rangeLabel}`}
            description={`${total} booking${total === 1 ? "" : "s"} in this window with these filters; ${reservations.length} on this page, earliest arrival first.`}
          >
            {total === 0 ? (
              <EmptyState title="No bookings for that day">
                The list only covers the restaurant&apos;s own day unless you widen the range with From/To.{" "}
                {active.length > 0 ? "Clear a filter above and try again." : "Widen the range, or search a booking code."}
              </EmptyState>
            ) : (
              <>
                <ReservationList reservations={reservations} timeZone={timeZone} />
                <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="muted">
                    Page {page} of {pages} · earliest arrival first
                  </span>
                  <span className="flex gap-2">
                    {page > 1 ? (
                      <Link href={hrefFor({ page: String(page - 1) })} className="btn btn-outline btn-sm">
                        Previous page
                      </Link>
                    ) : null}
                    {page < pages ? (
                      <Link href={hrefFor({ page: String(page + 1) })} className="btn btn-outline btn-sm">
                        Next page
                      </Link>
                    ) : null}
                  </span>
                </nav>
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function AdminReservationsPage(props: PageProps<"/admin/reservations">) {
  return (
    <Suspense fallback={<BookingsSkeleton />}>
      <BookingsBody searchParams={props.searchParams} />
    </Suspense>
  );
}
