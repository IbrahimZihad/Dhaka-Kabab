import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { paginate } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { listCustomers, listWalkInGuests, spendWindow } from "@/server/services/customer.service";
import { siteContext } from "@/server/http/site";
import { EmptyState, Note, Panel } from "@/components/admin/admin-ui";
import { RegisteredCustomerTable, WalkInGuestTable } from "@/components/admin/customer-list";

export const metadata: Metadata = { title: "Customers" };

/** Everything the address bar can carry, so a view survives reload and can be shared. */
const FILTER_KEYS = ["view", "search", "active", "from", "to", "page", "pageSize"] as const;

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

/** "1" = active accounts, "0" = deactivated. Anything else means no filter. */
function oneActive(value: string | undefined): "1" | "0" | undefined {
  if (value === "1" || value === "true") return "1";
  if (value === "0" || value === "false") return "0";
  return undefined;
}

/** A day we can bound the spend window by. Nonsense is refused, never guessed at. */
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
  return "The customer book could not be read.";
}

function CustomersSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <span className="skeleton block h-48" />
      <span className="skeleton block h-72" />
    </div>
  );
}

async function CustomersBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "customer:view")) {
    return (
      <Panel title="Customers" description="The customer book holds diners' contact details, so it belongs to the roles that serve them.">
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

  const mayManage = roleHasPermission(user.role, "customer:manage");

  const raw = await searchParams;
  const isWalkIns = single(raw, "view") === "walkins";
  const search = single(raw, "search")?.slice(0, 80);
  const activeFilter = oneActive(single(raw, "active"));
  const askedFrom = single(raw, "from");
  const askedTo = single(raw, "to");
  const fromKey = validDateKey(askedFrom);
  const toKey = validDateKey(askedTo);
  const ignoredDays = [askedFrom, askedTo].filter((asked) => asked !== undefined && validDateKey(asked) === undefined);
  const { page, pageSize, skip, take } = paginate({
    page: positiveInt(single(raw, "page")),
    pageSize: positiveInt(single(raw, "pageSize")),
  });

  const { timeZone } = await siteContext();

  const current: Record<string, string | undefined> = {
    view: isWalkIns ? "walkins" : undefined,
    search: isWalkIns ? undefined : search,
    active: isWalkIns ? undefined : activeFilter,
    from: isWalkIns ? undefined : fromKey,
    to: isWalkIns ? undefined : toKey,
    page: page > 1 ? String(page) : undefined,
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
    return query ? `/admin/customers?${query}` : "/admin/customers";
  }

  const active: { key: string; label: string; value: string }[] = [];
  if (search) active.push({ key: "search", label: "Search", value: search });
  if (activeFilter !== undefined) {
    active.push({ key: "active", label: "Status", value: activeFilter === "1" ? "Active only" : "Deactivated only" });
  }
  if (fromKey) active.push({ key: "from", label: "From", value: fromKey });
  if (toKey) active.push({ key: "to", label: "To", value: toKey });

  let failure: string | null = null;
  let customers: Awaited<ReturnType<typeof listCustomers>>["customers"] = [];
  let guests: Awaited<ReturnType<typeof listWalkInGuests>> = [];
  let total = 0;

  try {
    if (isWalkIns) {
      guests = await listWalkInGuests({ skip, take });
    } else {
      const listed = await listCustomers(
        {
          search,
          active: activeFilter === undefined ? undefined : activeFilter === "1",
          ...(await spendWindow(fromKey, toKey)),
        },
        { skip, take },
      );
      customers = listed.customers;
      total = listed.total;
    }
  } catch (error) {
    failure = describeFailure(error);
  }

  // The walk-in service returns a page of groups without a total count, so the
  // honest navigation is "show another page if this one was full".
  const pages = isWalkIns ? Math.max(page, guests.length === take ? page + 1 : page) : Math.max(1, Math.ceil(total / pageSize));
  const rowsShown = isWalkIns ? guests.length : customers.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="hint mt-1">
            {isWalkIns
              ? "Diners who paid through a table QR without signing up. Each row is a name and number captured on their orders — no account behind it."
              : `Registered diners. Order counts and spend are summed from their stored orders (cancelled orders left out), on the restaurant's clock (${timeZone}).`}
          </p>
        </div>
        <Link href="/admin/customers" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={hrefFor({ view: null, page: null })} className={isWalkIns ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm"}>
          Registered accounts
        </Link>
        <Link href={hrefFor({ view: "walkins", page: null })} className={isWalkIns ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}>
          Walk-in guests
        </Link>
      </div>

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the records are where they were.{" "}
          <Link href="/admin/customers" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : isWalkIns ? (
        <>
          <Panel
            title="Walk-in guests"
            description="Grouped by the name and number on each order, newest visit first. The list is read-only — these diners have no account to edit."
          >
            {guests.length === 0 ? (
              <EmptyState title="No walk-in guests recorded yet">
                This appears once someone orders through a table QR code without signing in.
              </EmptyState>
            ) : (
              <>
                <WalkInGuestTable guests={guests} timeZone={timeZone} />
                <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="muted">Page {page} · newest visit first</span>
                  <span className="flex gap-2">
                    {page > 1 ? (
                      <Link href={hrefFor({ page: String(page - 1) })} className="btn btn-outline btn-sm">
                        Previous page
                      </Link>
                    ) : null}
                    {guests.length === take ? (
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
      ) : (
        <>
          <Panel title="Find customers" description="Search matches a name, an email or the digits of a phone number. Filters live in the address, so a view survives a reload or can be shared.">
            <form method="get" action="/admin/customers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label" htmlFor="customers-search">
                  Name, email or phone
                </label>
                <input
                  id="customers-search"
                  type="search"
                  name="search"
                  defaultValue={search ?? ""}
                  maxLength={80}
                  placeholder="Rahim / rahim@example.com / 01712…"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="label" htmlFor="customers-active">
                  Account status
                </label>
                <select id="customers-active" name="active" defaultValue={activeFilter ?? ""} className="select mt-1">
                  <option value="">Any account</option>
                  <option value="1">Active only</option>
                  <option value="0">Deactivated only</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="customers-from">
                  Spend from (day)
                </label>
                <input id="customers-from" type="date" name="from" defaultValue={fromKey ?? ""} className="input mt-1" />
              </div>
              <div>
                <label className="label" htmlFor="customers-to">
                  Spend to (day)
                </label>
                <input id="customers-to" type="date" name="to" defaultValue={toKey ?? ""} className="input mt-1" />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <button type="submit" className="btn btn-outline btn-sm">
                  Show customers
                </button>
                <span className="hint ml-3">
                  The two days bound only the spend and order-count columns — orders taken on or after &ldquo;from&rdquo; and
                  before &ldquo;to&rdquo;. Leave them empty for all-time totals. The account list itself is not filtered by date.
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
              <p className="hint mt-4">No filters applied.</p>
            )}

            {ignoredDays.length > 0 ? (
              <p className="notice notice-error mt-4">
                &ldquo;{ignoredDays.join("&rdquo;, &ldquo;")}&rdquo; {ignoredDays.length === 1 ? "is" : "are"} not a day we can
                read, so the spend window was left open. Dates are written YYYY-MM-DD.
              </p>
            ) : null}
          </Panel>

          <Panel title="The book" description={`${total} account${total === 1 ? "" : "s"} match${total === 1 ? "es" : ""} this search; ${rowsShown} shown on this page, newest account first.`}>
            {!mayManage ? (
              <p className="hint mb-3">
                Editing a customer needs the customer-management permission, which this role does not carry; every page
                below is read-only for you.
              </p>
            ) : null}
            {total === 0 ? (
              <EmptyState title={search || activeFilter !== undefined ? "No accounts match" : "No customer accounts yet"}>
                {search || activeFilter !== undefined
                  ? "Nobody in the book fits these filters. Widen the search or clear a filter above."
                  : "Registered diners appear here the moment someone makes an account."}
              </EmptyState>
            ) : (
              <>
                <RegisteredCustomerTable customers={customers} timeZone={timeZone} />
                <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="muted">
                    Page {page} of {pages} · newest account first
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

export default function AdminCustomersPage(props: PageProps<"/admin/customers">) {
  return (
    <Suspense fallback={<CustomersSkeleton />}>
      <CustomersBody searchParams={props.searchParams} />
    </Suspense>
  );
}
