import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa } from "@/lib/money";
import { AppError } from "@/lib/errors";
import { dayRange, formatDateInZone } from "@/lib/time";
import { PAYMENT_METHOD_LABELS, RESERVATION_STATUS_LABELS } from "@/lib/staff-format";
import { providerReadiness } from "@/server/services/providers";
import { getSettings } from "@/server/services/settings.service";
import {
  categorySales,
  dailySales,
  demandHeatmap,
  kitchenPerformance,
  paymentCollection,
  reservationStats,
  tableUtilisation,
  topItems,
  windowFor,
  type DateWindow,
  type ReportKind,
} from "@/server/services/analytics.service";
import { AdminTable, EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";

export const metadata: Metadata = { title: "Reports" };

/**
 * Trading reports. Every figure is read from real rows through the analytics
 * service — nothing is estimated. Simulated-gateway money is subtracted from
 * anything called "collected", because it never reached a bank.
 */

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

const RANGE_KEYS: RangeKey[] = ["today", "yesterday", "7d", "30d", "month", "custom"];

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  custom: "Chosen dates",
};

const DOWNLOADS: { kind: ReportKind; label: string; blurb: string }[] = [
  { kind: "sales", label: "Daily sales", blurb: "One line per trading day: orders taken, billed takings, discounts." },
  { kind: "orders", label: "Orders", blurb: "Every order in the window with its full bill breakdown and demo flag." },
  { kind: "items", label: "Item sales", blurb: "Units sold and revenue for every dish, up to 500 lines." },
  { kind: "payments", label: "Payments", blurb: "Every payment: method, status, gateway reference, and whether it was simulated money." },
  { kind: "reservations", label: "Reservations", blurb: "Bookings that start in the window, with guests and tables." },
  { kind: "tables", label: "Table utilisation", blurb: "Sessions, covers and billed revenue per table." },
  { kind: "customers", label: "Customers", blurb: "Guest accounts, order counts and lifetime spend." },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

/** A date the restaurant's clock can bound, written YYYY-MM-DD. Nonsense is refused, never guessed at. */
function validDateKey(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? undefined : value;
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "The report figures could not be read.";
}

/** Horizontal bar whose width is the true share of the largest value in the set. */
function Bar({ value, max }: { value: number; max: number }) {
  if (max <= 0 || value <= 0) return <span className="muted">—</span>;
  const percent = Math.max(2, Math.round((value / max) * 100));
  return (
    <span className="block h-2 w-full max-w-40 rounded bg-line" aria-hidden="true">
      <span className="block h-2 rounded bg-brand" style={{ width: `${percent}%` }} />
    </span>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <span className="skeleton block h-24" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <span className="skeleton block h-72" />
    </div>
  );
}

async function ReportsBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "report:view")) {
    return (
      <Panel title="Reports" description="This screen shows takings, so it is limited to the roles that handle money.">
        <p className="text-sm soft">
          Your role is not given the reports permission, so no figures are shown here.{" "}
          {user.role === "KITCHEN" ? (
            <>
              Your screen is the{" "}
              <Link href="/kitchen" className="underline">
                kitchen display
              </Link>
              , where orders arrive as guests send them.
            </>
          ) : (
            "The order and bill sections you can open are listed in the menu above."
          )}
        </p>
      </Panel>
    );
  }

  const settings = await getSettings();
  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;

  const raw = await searchParams;
  const askedRange = single(raw, "range");
  const ignoredRange = askedRange !== undefined && !RANGE_KEYS.includes(askedRange as RangeKey);
  const askedFrom = single(raw, "from");
  const askedTo = single(raw, "to");
  const from = validDateKey(askedFrom);
  const to = validDateKey(askedTo);

  // The address bar asks; the page decides. A custom range without two usable
  // dates is refused with a plain note and the view falls back to today — the
  // same contract the CSV endpoint enforces.
  let rejected: string | null = null;
  let range: RangeKey = RANGE_KEYS.includes(askedRange as RangeKey) ? (askedRange as RangeKey) : "today";
  if (range === "custom") {
    if (!from || !to) {
      rejected =
        askedFrom === undefined && askedTo === undefined
          ? "No dates were given yet, so today is shown instead. Pick a start and an end below."
          : `“${askedFrom ?? ""}” to “${askedTo ?? ""}” is not a pair of dates we can read (YYYY-MM-DD), so today is shown instead.`;
      range = "today";
    } else {
      const fromDay = dayRange(from, timeZone);
      const toDay = dayRange(to, timeZone);
      if (toDay.end <= fromDay.start) {
        rejected = "The end date is before the start date, so today is shown instead.";
        range = "today";
      }
    }
  }

  let span: DateWindow | null = null;
  let failure: string | null = null;
  let data: Awaited<ReturnType<typeof loadReport>> | null = null;
  try {
    const custom =
      range === "custom" && from && to
        ? { from: dayRange(from, timeZone).start, to: dayRange(to, timeZone).end }
        : undefined;
    span = windowFor(range, timeZone, custom);
    data = await loadReport(span);
  } catch (error) {
    failure = describeFailure(error);
  }

  function reportsHref(overrides: Partial<{ range: string; from: string | null; to: string | null }> = {}): string {
    const params = new URLSearchParams();
    const nextRange = overrides.range ?? range;
    if (nextRange !== "today") params.set("range", nextRange);
    const nextFrom = overrides.from === undefined ? (nextRange === "custom" ? from : null) : overrides.from;
    const nextTo = overrides.to === undefined ? (nextRange === "custom" ? to : null) : overrides.to;
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    const query = params.toString();
    return query ? `/admin/reports?${query}` : "/admin/reports";
  }

  function csvHref(kind: ReportKind): string {
    const params = new URLSearchParams({ range });
    if (range === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    return `/api/admin/reports/${kind}?${params}`;
  }

  const windowLine = span
    ? range === "today"
      ? `Today on the restaurant's own clock (${timeZone}) — ${formatDateInZone(span.from, timeZone)}.`
      : `From ${formatDateInZone(span.from, timeZone)} to ${formatDateInZone(new Date(span.to.getTime() - 1), timeZone)}, counted on the restaurant's own clock (${timeZone}). The window ends at the midnight after the last day.`
    : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="hint mt-1">
          {windowLine} Figures come straight from stored orders and verified payments; money is integer poisa, shown
          as {symbol} takings.
        </p>
      </div>

      <Panel title="Choose a window" description="Every link below is a plain address, so a view can be shared or reloaded.">
        <div className="flex flex-wrap gap-2">
          {RANGE_KEYS.filter((key) => key !== "custom").map((key) => (
            <Link
              key={key}
              href={reportsHref({ range: key })}
              className={`btn btn-sm ${range === key ? "btn-primary" : "btn-outline"}`}
              aria-current={range === key ? "true" : undefined}
            >
              {RANGE_LABELS[key]}
            </Link>
          ))}
        </div>
        <form method="get" action="/admin/reports" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="range" value="custom" readOnly />
          <div>
            <label className="label" htmlFor="reports-from">
              From
            </label>
            <input id="reports-from" type="date" name="from" defaultValue={range === "custom" ? from ?? "" : ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="reports-to">
              To
            </label>
            <input id="reports-to" type="date" name="to" defaultValue={range === "custom" ? to ?? "" : ""} className="input mt-1" />
          </div>
          <button type="submit" className={`btn btn-sm ${range === "custom" ? "btn-primary" : "btn-outline"}`}>
            Show these dates
          </button>
        </form>
        {ignoredRange ? (
          <p className="notice mt-4">“{askedRange}” is not a window we understand, so today is shown.</p>
        ) : null}
        {rejected ? <p className="notice notice-error mt-4">{rejected}</p> : null}
      </Panel>

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the orders and payments are where they were.{" "}
          <Link href="/admin/reports" className="underline">
            Reload with today
          </Link>
          .
        </Note>
      ) : null}

      {data && span ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Billed in window"
              value={formatPoisa(data.billedPoisa, { symbol })}
              hint={`${data.ordersInWindow} order(s) taken, excluding cancelled`}
            />
            <Stat
              label="Actually collected"
              value={formatPoisa(data.realCollectedPoisa, { symbol })}
              hint={
                data.collections.demoCollectedPoisa > 0
                  ? `${formatPoisa(data.collections.demoCollectedPoisa, { symbol })} more was collected but flagged simulated and left out here`
                  : "Succeeded payments only"
              }
            />
            <Stat
              label="Average order"
              value={formatPoisa(data.averageOrderPoisa, { symbol })}
              hint={
                data.ordersInWindow > 0
                  ? "Billed poisa divided by orders, not by collected money"
                  : "No orders in this window to average"
              }
            />
            <Stat
              label="Bookings in window"
              value={data.reservations.total}
              hint={data.reservations.confirmedCovers > 0 ? `${data.reservations.confirmedCovers} covers expected from confirmed bookings` : "None to honour"}
            />
          </div>

          <Note kind="info">
            Two different questions, deliberately kept apart: billed is what orders added up to, collected is what the
            payment records show as received. While a table is still dining they differ — that gap is real, not an error.
            {data.gatewaySimulated
              ? " On this install the online gateway is simulated: online payment money never reached a bank and is shown separately below."
              : ""}
          </Note>

          {data.ordersInWindow === 0 && data.collections.byMethod.length === 0 && data.reservations.total === 0 ? (
            <EmptyState title={`No trade in this window — ${RANGE_LABELS[range]}`}>
              {range === "today"
                ? "Not one order has been taken on the restaurant's clock today. Try a longer window above."
                : "Nothing was ordered, paid or booked in these dates. Pick another window above."}
            </EmptyState>
          ) : null}

          <Panel title="Daily sales" description="Billed takings per trading day; the bar is the day's share of the best day in the window.">
            {data.sales.length === 0 ? (
              <EmptyState title="No orders were taken">Nothing to draw until an order exists in this window.</EmptyState>
            ) : (
              <AdminTable head={["Day", "Orders", "Billed", "Discounts given", "Share of best day"]}>
                {data.sales.map((row) => (
                  <tr key={row.day} className="border-b border-line/60">
                    <td className="px-3 py-2 font-mono">{row.day}</td>
                    <td className="px-3 py-2 tabular-nums">{row.orders}</td>
                    <td className="price px-3 py-2 tabular-nums">{row.revenueLabel}</td>
                    <td className="px-3 py-2 tabular-nums soft">{formatPoisa(row.discountPoisa, { symbol })}</td>
                    <td className="px-3 py-2">
                      <Bar value={row.revenuePoisa} max={data.maxDailyPoisa} />
                    </td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </Panel>

          <Panel title="Money collected, by method" description="Only payments whose status is received. Simulated gateway money is broken out, never merged.">
            {data.collections.byMethod.length === 0 ? (
              <EmptyState title="No payments received">
                No payment has reached a received state in {RANGE_LABELS[range].toLowerCase()}.
              </EmptyState>
            ) : (
              <>
                <AdminTable head={["Method", "Payments", "Collected"]}>
                  {data.collections.byMethod.map((row) => (
                    <tr key={row.method} className="border-b border-line/60">
                      <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[row.method as keyof typeof PAYMENT_METHOD_LABELS] ?? row.method}</td>
                      <td className="px-3 py-2 tabular-nums">{row.payments}</td>
                      <td className="price px-3 py-2 tabular-nums">{row.amountLabel}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-line/60">
                    <td className="px-3 py-2 font-semibold">All received payments</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{data.collectionCount}</td>
                    <td className="price px-3 py-2 tabular-nums font-semibold">{formatPoisa(data.collectedPoisa, { symbol })}</td>
                  </tr>
                </AdminTable>
                {data.collections.demoCollectedPoisa > 0 ? (
                  <p className="notice mt-3">
                    {formatPoisa(data.collections.demoCollectedPoisa, { symbol })} of the total above was taken on the
                    simulated gateway and is not real money. The &ldquo;Actually collected&rdquo; figure at the top
                    excludes it.
                  </p>
                ) : (
                  <p className="hint mt-3">No payment in this window carries the simulated flag.</p>
                )}
              </>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Top items" description="By revenue over orders that were not cancelled, in revenue order.">
              {data.items.length === 0 ? (
                <EmptyState title="No items sold">No order lines exist in this window.</EmptyState>
              ) : (
                <AdminTable head={["Item", "Sold", "Revenue", ""]}>
                  {data.items.map((row) => (
                    <tr key={row.name} className="border-b border-line/60">
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 tabular-nums">{row.sold}</td>
                      <td className="price px-3 py-2 tabular-nums">{row.revenueLabel}</td>
                      <td className="px-3 py-2">
                        <Bar value={row.revenuePoisa} max={data.items[0].revenuePoisa} />
                      </td>
                    </tr>
                  ))}
                </AdminTable>
              )}
            </Panel>

            <Panel title="Sales by category" description="Menu section totals; a deleted dish keeps its snapshot name rather than vanishing.">
              {data.categories.length === 0 ? (
                <EmptyState title="No category sales">Nothing was billed in this window.</EmptyState>
              ) : (
                <AdminTable head={["Category", "Units", "Revenue", ""]}>
                  {data.categories.map((row) => (
                    <tr key={row.category} className="border-b border-line/60">
                      <td className="px-3 py-2">{row.category}</td>
                      <td className="px-3 py-2 tabular-nums">{row.units}</td>
                      <td className="price px-3 py-2 tabular-nums">{row.revenueLabel}</td>
                      <td className="px-3 py-2">
                        <Bar value={row.revenuePoisa} max={data.categories[0].revenuePoisa} />
                      </td>
                    </tr>
                  ))}
                </AdminTable>
              )}
            </Panel>
          </div>

          <Panel title="Demand by day and hour" description="Orders taken, counted on the restaurant's clock. Darker means busier; for staffing, not takings.">
            {data.heatmap.length === 0 ? (
              <EmptyState title="No orders to place on the grid">This window saw no trade, so the grid stays honest and blank.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0.5 text-center text-xs tabular-nums">
                  <thead>
                    <tr>
                      <th className="label px-1 py-1 text-left">Day</th>
                      {Array.from({ length: 24 }).map((_, hour) => (
                        <th key={hour} className="label px-1 py-1 font-normal">
                          {hour}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAYS.map((day, weekday) => (
                      <tr key={day}>
                        <td className="label px-1 py-1 text-left">{day}</td>
                        {Array.from({ length: 24 }).map((_, hour) => {
                          const orders = data.heatMap.get(`${weekday}-${hour}`) ?? 0;
                          const ratio = data.maxHeat === 0 ? 0 : orders / data.maxHeat;
                          return (
                            <td
                              key={hour}
                              className="px-1 py-1"
                              style={orders > 0 ? { backgroundColor: `rgba(184, 71, 31, ${0.15 + 0.75 * ratio})`, color: ratio > 0.55 ? "#fff" : undefined } : undefined}
                            >
                              {orders > 0 ? orders : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint mt-2">
                  Busiest single hour holds {data.maxHeat} order(s). Hours with no orders are left blank, not zeroed.
                </p>
              </div>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Kitchen performance" description="Minutes from order received to order ready, for orders that recorded a ready time.">
              {data.kitchen.ordersMeasured === 0 ? (
                <EmptyState title="Nothing measured">No order in this window has a recorded ready time.</EmptyState>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Stat label="Orders measured" value={data.kitchen.ordersMeasured} hint="Out of orders taken in the window" />
                    <Stat label="Average to ready" value={`${data.kitchen.averageMinutes} min`} hint="Straight mean of measured orders" />
                  </div>
                  <p className="label mt-4">Slowest five</p>
                  <ul className="mt-1 divide-y divide-line text-sm">
                    {data.kitchen.slowest.map((row) => (
                      <li key={row.orderNumber} className="flex items-center justify-between py-1.5">
                        <span className="font-mono">{row.orderNumber}</span>
                        <span className="soft tabular-nums">{row.minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel title="Reservations" description="Bookings whose start time falls in the window.">
              {data.reservations.total === 0 ? (
                <EmptyState title="No bookings">Nothing was reserved to start in {RANGE_LABELS[range].toLowerCase()}.</EmptyState>
              ) : (
                <>
                  <ul className="space-y-2 text-sm">
                    {Object.entries(data.reservations.byStatus).map(([status, count]) => (
                      <li key={status} className="flex items-center justify-between gap-3">
                        <span>{RESERVATION_STATUS_LABELS[status as keyof typeof RESERVATION_STATUS_LABELS] ?? status}</span>
                        <span className="tabular-nums font-semibold">{count}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="label">Total bookings</dt>
                      <dd className="soft tabular-nums">{data.reservations.total}</dd>
                    </div>
                    <div>
                      <dt className="label">Covers from confirmed</dt>
                      <dd className="soft tabular-nums">{data.reservations.confirmedCovers}</dd>
                    </div>
                    <div>
                      <dt className="label">Did not arrive</dt>
                      <dd className="soft">{data.reservations.noShowRate === null ? "—" : `${data.reservations.noShowRate}%`}</dd>
                    </div>
                  </dl>
                </>
              )}
            </Panel>
          </div>

          <Panel title="Table utilisation" description="Sessions opened in the window; revenue is billed, per the orders bound to each visit.">
            {data.tablesSessionsTotal === 0 ? (
              <EmptyState title="No table sessions">No visit was opened on the floor in this window.</EmptyState>
            ) : (
              <AdminTable head={["Table", "Sessions", "Covers", "Billed", ""]}>
                {data.tables.map((row) => (
                  <tr key={row.table} className="border-b border-line/60">
                    <td className="px-3 py-2">{row.table}</td>
                    <td className="px-3 py-2 tabular-nums">{row.sessions}</td>
                    <td className="px-3 py-2 tabular-nums">{row.covers}</td>
                    <td className="price px-3 py-2 tabular-nums">{row.revenueLabel}</td>
                    <td className="px-3 py-2">
                      <Bar value={row.revenuePoisa} max={data.tables[0]?.revenuePoisa ?? 0} />
                    </td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </Panel>

          <Panel
            title="Downloads"
            description="CSV of the same figures, for the exact window shown. Amounts arrive as integer poisa beside a formatted label."
          >
            <ul className="divide-y divide-line">
              {DOWNLOADS.map((row) => (
                <li key={row.kind} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{row.label}</span>{" "}
                    <span className="muted">— {row.blurb}</span>
                  </span>
                  <a href={csvHref(row.kind)} className="btn btn-outline btn-sm">
                    Download {row.label} CSV
                  </a>
                </li>
              ))}
            </ul>
            <p className="hint mt-3">
              The download link asks the server for {RANGE_LABELS[range].toLowerCase()}
              {range === "custom" && from && to ? ` (${from} to ${to})` : ""}. The endpoint checks the same reports
              permission this page does — a link is not a way past it.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

async function loadReport(window: DateWindow) {
  const [sales, collections, items, categories, heatmap, kitchen, reservations, tables, gateway] = await Promise.all([
    dailySales(window),
    paymentCollection(window),
    topItems(window, 15),
    categorySales(window),
    demandHeatmap(window),
    kitchenPerformance(window),
    reservationStats(window),
    tableUtilisation(window),
    providerReadiness(),
  ]);

  const billedPoisa = sales.reduce((total, row) => total + row.revenuePoisa, 0);
  const ordersInWindow = sales.reduce((total, row) => total + row.orders, 0);
  const collectedPoisa = collections.byMethod.reduce((total, row) => total + (row.amountPoisa ?? 0), 0);
  const collectionCount = collections.byMethod.reduce((total, row) => total + row.payments, 0);
  const heatMap = new Map(heatmap.map((row) => [`${row.weekday}-${row.hour}`, row.orders]));

  return {
    sales,
    collections,
    items,
    categories,
    heatmap,
    kitchen,
    reservations,
    tables,
    gatewaySimulated: gateway.configured === "simulated",
    billedPoisa,
    ordersInWindow,
    collectedPoisa,
    collectionCount,
    /** Simulated-gateway payments removed — this is the money that is real. */
    realCollectedPoisa: collectedPoisa - collections.demoCollectedPoisa,
    averageOrderPoisa: ordersInWindow > 0 ? Math.round(billedPoisa / ordersInWindow) : 0,
    maxDailyPoisa: sales.reduce((max, row) => Math.max(max, row.revenuePoisa), 0),
    maxHeat: heatmap.reduce((max, row) => Math.max(max, row.orders), 0),
    tablesSessionsTotal: tables.reduce((total, row) => total + row.sessions, 0),
    heatMap,
  };
}

export default function AdminReportsPage(props: PageProps<"/admin/reports">) {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsBody searchParams={props.searchParams} />
    </Suspense>
  );
}
