import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewKitchenFinancials, roleHasPermission } from "@/lib/auth/rbac";
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from "@/lib/staff-format";
import { paginate } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { dayRange, todayKey } from "@/lib/time";
import { getOrderCounters, listOrders } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { staffOrder } from "@/server/http/order-view";
import { EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";
import { OrderList } from "@/components/admin/order-list";

export const metadata: Metadata = { title: "Orders" };

type StatusKey = keyof typeof ORDER_STATUS_LABELS;
type TypeKey = keyof typeof ORDER_TYPE_LABELS;

/** Everything the address bar can carry, so a view can be shared or reloaded. */
const FILTER_KEYS = ["status", "type", "search", "dateKey", "tableId", "sessionId", "page", "pageSize"] as const;

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

function oneOf<T extends string>(labels: Record<T, string>, value: string | undefined): T | undefined {
  if (!value) return undefined;
  return Object.prototype.hasOwnProperty.call(labels, value) ? (value as T) : undefined;
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
  return "The orders could not be read.";
}

function OrdersSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <span className="skeleton block h-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <span className="skeleton block h-72" />
    </div>
  );
}

async function OrdersBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "order:view:any")) {
    return (
      <Panel title="Orders" description="This section belongs to the roles that handle orders.">
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

  const raw = await searchParams;
  const status = oneOf(ORDER_STATUS_LABELS, single(raw, "status"));
  const type = oneOf(ORDER_TYPE_LABELS, single(raw, "type"));
  const tableId = single(raw, "tableId");
  const sessionId = single(raw, "sessionId");
  const search = single(raw, "search")?.slice(0, 60);
  const askedDateKey = single(raw, "dateKey");
  const dateKeyFilter = validDateKey(askedDateKey);
  const ignoredDateKey = askedDateKey !== undefined && dateKeyFilter === undefined;
  const { page, pageSize, skip, take } = paginate({
    page: positiveInt(single(raw, "page")),
    pageSize: positiveInt(single(raw, "pageSize")),
  });

  const settings = await getSettings();
  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;
  // Same contract as the endpoint: one day on the restaurant's own clock, and a
  // day left unchosen means their today.
  const dateKey = dateKeyFilter ?? todayKey(timeZone);
  const window = dayRange(dateKey, timeZone);
  // Money and the guest's number follow the role, worked out here on the server.
  // The kitchen list also keeps finished orders out, exactly as the API does.
  const financials = canViewKitchenFinancials(user.role);

  const current: Record<string, string | undefined> = {
    status,
    type,
    tableId,
    sessionId,
    search,
    dateKey: dateKeyFilter,
    page: page > 1 ? String(page) : undefined,
    // Only named when it differs from the endpoint's own page size, so a shared
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
    return query ? `/admin/orders?${query}` : "/admin/orders";
  }

  const active: { key: string; label: string; value: string }[] = [];
  if (status) active.push({ key: "status", label: "Status", value: ORDER_STATUS_LABELS[status] });
  if (type) active.push({ key: "type", label: "Type", value: ORDER_TYPE_LABELS[type] });
  if (search) active.push({ key: "search", label: "Search", value: search });
  if (tableId) active.push({ key: "tableId", label: "Table", value: tableId });
  if (sessionId) active.push({ key: "sessionId", label: "Visit", value: sessionId });
  if (dateKeyFilter) active.push({ key: "dateKey", label: "Day", value: dateKeyFilter });

  let failure: string | null = null;
  let orders: ReturnType<typeof staffOrder>[] = [];
  let total = 0;
  let counters: Awaited<ReturnType<typeof getOrderCounters>> | null = null;

  try {
    const [listed, counted] = await Promise.all([
      listOrders(
        { status, type, tableId, sessionId, search, from: window.start, to: window.end, kitchenView: financials ? undefined : true },
        { skip, take },
      ),
      getOrderCounters(),
    ]);
    orders = listed.orders.map((order) => staffOrder(order, symbol, { financials }));
    total = listed.total;
    counters = counted;
  } catch (error) {
    failure = describeFailure(error);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const tiles = counters
    ? [
        { status: "PENDING" as StatusKey, count: counters.pending },
        { status: "PREPARING" as StatusKey, count: counters.preparing },
        { status: "READY" as StatusKey, count: counters.ready },
        { status: "SERVED" as StatusKey, count: counters.served },
        { status: "COMPLETED" as StatusKey, count: counters.completed },
        { status: "CANCELLED" as StatusKey, count: counters.cancelled },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="hint mt-1">
            {dateKey === todayKey(timeZone)
              ? `Taken today — ${dateKey} on the restaurant's own clock (${timeZone}).`
              : `Taken on ${dateKey}.`}{" "}
            Money and guest numbers follow your role, never the address bar.
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      <Panel title="Find orders" description="Filters live in the address, so a view can be shared or reloaded.">
        <form method="get" action="/admin/orders" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="orders-search">
              Order number or guest name
            </label>
            <input
              id="orders-search"
              type="search"
              name="search"
              defaultValue={search ?? ""}
              maxLength={60}
              placeholder="DK-…"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="label" htmlFor="orders-status">
              Status
            </label>
            <select id="orders-status" name="status" defaultValue={status ?? ""} className="select mt-1">
              <option value="">Any status</option>
              {(Object.keys(ORDER_STATUS_LABELS) as StatusKey[]).map((key) => (
                <option key={key} value={key}>
                  {ORDER_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="orders-type">
              Type
            </label>
            <select id="orders-type" name="type" defaultValue={type ?? ""} className="select mt-1">
              <option value="">Any type</option>
              {(Object.keys(ORDER_TYPE_LABELS) as TypeKey[]).map((key) => (
                <option key={key} value={key}>
                  {ORDER_TYPE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="orders-date">
              Day
            </label>
            <input id="orders-date" type="date" name="dateKey" defaultValue={dateKeyFilter ?? ""} className="input mt-1" />
          </div>
          {tableId ? <input type="hidden" name="tableId" value={tableId} readOnly /> : null}
          {sessionId ? <input type="hidden" name="sessionId" value={sessionId} readOnly /> : null}
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn btn-outline btn-sm">
              Show orders
            </button>
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
            No filters applied. A table or a visit can be linked here from the floor board, or search an order number.
          </p>
        )}

        {ignoredDateKey ? (
          <p className="notice notice-error mt-4">
            “{askedDateKey}” is not a day we can read, so today is shown instead. Dates are written YYYY-MM-DD.
          </p>
        ) : null}
      </Panel>

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the orders are where they were.{" "}
          <Link href="/admin/orders" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : (
        <>
          <Panel title="Where orders stand" description="Counted by the orders endpoint, for orders taken since midnight.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tiles.map((tile) => (
                <Link key={tile.status} href={hrefFor({ status: tile.status, page: null })} className="block">
                  <Stat label={ORDER_STATUS_LABELS[tile.status]} value={tile.count} />
                </Link>
              ))}
            </div>
            <p className="hint mt-3">
              Choose a tile to list that status. The endpoint keeps no figure of its own for confirmed orders, so none
              is invented here.
            </p>
          </Panel>

          <Panel
            title={active.length > 0 ? "Matching orders" : `Orders on ${dateKey}`}
            description={`${total} order${total === 1 ? "" : "s"} for this day with these filters; ${orders.length} on this page.`}
          >
            {total === 0 ? (
              <EmptyState title="No orders match">
                The panel only shows orders taken today unless you pick another date.{" "}
                {active.length > 0 ? "Clear a filter above and try again." : "Choose a day, or search an order number."}
              </EmptyState>
            ) : (
              <>
                <OrderList orders={orders} timeZone={timeZone} financials={financials} />
                <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="muted">
                    Page {page} of {pages} · newest first
                  </span>
                  <span className="flex gap-2">
                    {page > 1 ? (
                      <Link href={hrefFor({ page: String(page - 1) })} className="btn btn-outline btn-sm">
                        Newer orders
                      </Link>
                    ) : null}
                    {page < pages ? (
                      <Link href={hrefFor({ page: String(page + 1) })} className="btn btn-outline btn-sm">
                        Earlier orders
                      </Link>
                    ) : null}
                  </span>
                </nav>
              </>
            )}
            {!financials ? (
              <p className="hint mt-3">
                Kitchen staff are shown the dishes, the table and the notes only — no totals, no guest numbers, and no
                orders that have already finished.
              </p>
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function AdminOrdersPage(props: PageProps<"/admin/orders">) {
  return (
    <Suspense fallback={<OrdersSkeleton />}>
      <OrdersBody searchParams={props.searchParams} />
    </Suspense>
  );
}
