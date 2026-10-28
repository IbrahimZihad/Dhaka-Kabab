import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa } from "@/lib/money";
import { dayRange, formatInZone, todayKey } from "@/lib/time";
import {
  BILL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_RECORD_LABELS,
} from "@/lib/staff-format";
import type { BillStatus } from "@prisma/client";
import { getSettings } from "@/server/services/settings.service";
import { listBills } from "@/server/services/billing.service";
import { listPayments } from "@/server/services/payment.service";
import { AdminTable, EmptyState, Note, Panel, Stat, StatusBadge } from "@/components/admin/admin-ui";
import { PaymentStatusCheck } from "@/components/admin/payment-status-check";

const STATUS_VALUES = Object.keys(BILL_STATUS_LABELS) as BillStatus[];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 30;

function filterValue(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

type Filters = { status: BillStatus | ""; dateKey: string; search: string; page: number };

function readFilters(params: Record<string, string | string[] | undefined>, restaurantDay: string): Filters {
  const rawStatus = filterValue(params.status);
  const rawDate = filterValue(params.dateKey);
  const rawPage = Number(filterValue(params.page));
  return {
    status: (STATUS_VALUES as string[]).includes(rawStatus) ? (rawStatus as BillStatus) : "",
    dateKey: DATE_PATTERN.test(rawDate) ? rawDate : restaurantDay,
    search: filterValue(params.search).slice(0, 40),
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1,
  };
}

function hrefFor(filters: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.status) query.set("status", merged.status);
  if (merged.dateKey) query.set("dateKey", merged.dateKey);
  if (merged.search) query.set("search", merged.search);
  if (merged.page > 1) query.set("page", String(merged.page));
  const suffix = query.toString();
  return suffix ? `/admin/bills?${suffix}` : "/admin/bills";
}

async function BillsView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "bill:view")) {
    return (
      <Panel title="Bills" description="Totals, payments and receipts are handled at the counter.">
        <p className="hint">
          Your role is not given access to takings, so this screen stays empty. Your work is on the{" "}
          <Link href="/kitchen" className="underline">
            kitchen display
          </Link>{" "}
          or the orders the floor is serving.
        </p>
      </Panel>
    );
  }

  const settings = await getSettings();
  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;
  const filters = readFilters(await searchParams, todayKey(timeZone));
  const canSeePayments = roleHasPermission(user.role, "payment:view");

  let failure: string | null = null;
  let rows: Awaited<ReturnType<typeof listBills>>["bills"] = [];
  let total = 0;
  let waiting: Awaited<ReturnType<typeof listPayments>>["payments"] = [];

  try {
    const window = dayRange(filters.dateKey, timeZone);
    const [billResult, pendingResult] = await Promise.all([
      listBills(
        {
          status: filters.status || undefined,
          from: window.start,
          to: window.end,
          search: filters.search || undefined,
        },
        { skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE },
      ),
      canSeePayments ? listPayments({ status: "PENDING" }, { skip: 0, take: 20 }) : Promise.resolve(null),
    ]);
    rows = billResult.bills;
    total = billResult.total;
    waiting = pendingResult?.payments ?? [];
  } catch (error) {
    failure = error instanceof Error ? error.message : "The bills could not be read.";
  }

  const pageOutstandingPoisa = rows.reduce((sum, bill) => sum + Math.max(0, bill.totalPoisa - bill.paidPoisa), 0);
  const pageBilledPoisa = rows.reduce((sum, bill) => sum + bill.totalPoisa, 0);
  const pagePaidPoisa = rows.reduce((sum, bill) => sum + bill.paidPoisa, 0);
  const demoOnPage = rows.some((bill) => bill.isDemo);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bills &amp; payments</h1>
        <p className="hint mt-1">
          {filters.dateKey} · the restaurant&apos;s own day, in {timeZone}. Money is shown as received only where a
          payment was verified — by a staff member at the counter or by the bank&apos;s own notification.
        </p>
      </div>

      <form action="/admin/bills" method="get" className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="filter-status">
              Status
            </label>
            <select id="filter-status" name="status" className="select" defaultValue={filters.status}>
              <option value="">Any status</option>
              {STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {BILL_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filter-date">
              Day
            </label>
            <input id="filter-date" name="dateKey" type="date" className="input" defaultValue={filters.dateKey} />
          </div>
          <div>
            <label className="label" htmlFor="filter-search">
              Bill number or table
            </label>
            <input
              id="filter-search"
              name="search"
              className="input"
              maxLength={40}
              autoComplete="off"
              placeholder="Bill number or table label"
              defaultValue={filters.search}
            />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            <Link href="/admin/bills" className="btn btn-ghost">
              Reset
            </Link>
          </div>
        </div>
        <p className="hint mt-2">
          Every bill in the restaurant is one day at a time; pick another day or search a bill number to look further
          back.
        </p>
      </form>

      {failure ? <Note kind="error">{failure}</Note> : null}

      {!failure && rows.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Bills in this view" value={String(total)} hint={`Showing page ${filters.page} of ${pages}`} />
          <Stat label="Billed on this page" value={formatPoisa(pageBilledPoisa, { symbol })} />
          <Stat label="Received on this page" value={formatPoisa(pagePaidPoisa, { symbol })} />
          <Stat
            label="Outstanding on this page"
            value={formatPoisa(pageOutstandingPoisa, { symbol })}
            hint={demoOnPage ? "This page includes bills touched by the simulated gateway — that money is not real." : undefined}
          />
        </div>
      ) : null}

      <Panel title="Bills" description="What each table was charged, and what has actually come in.">
        {failure ? null : rows.length === 0 ? (
          <EmptyState title="No bills in this view">
            {filters.search
              ? `Nothing on ${filters.dateKey} matches “${filters.search}”. Bills are numbered per day, so a number from another week will not be found here.`
              : `Nothing was billed on ${filters.dateKey}${filters.status ? ` with the status ${BILL_STATUS_LABELS[filters.status]}` : ""}. Try another day, or clear the status filter.`}
          </EmptyState>
        ) : (
          <AdminTable
            head={[
              "Bill",
              "Table or session",
              "Status",
              "Subtotal",
              "Charges",
              "Total",
              "Received",
              "Outstanding",
              "Last activity",
              "Open",
            ]}
          >
            {rows.map((bill) => {
              const chargesPoisa = bill.serviceChargePoisa + bill.vatPoisa;
              const outstandingPoisa = Math.max(0, bill.totalPoisa - bill.paidPoisa);
              const session = bill.session;
              return (
                <tr key={bill.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    <span className="font-mono">{bill.number}</span>
                    {bill.isDemo ? <span className="badge badge-closed ml-2">Simulated</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {session ? (
                      <>
                        {session.table?.label ?? "Table not recorded"}
                        <span className="muted"> · {session.code}</span>
                      </>
                    ) : bill.order ? (
                      <>
                        <span className="font-mono">{bill.order.orderNumber}</span>
                        <span className="hint block">{bill.order.contactName ?? "Counter sale"}</span>
                      </>
                    ) : (
                      <span className="muted">not attached to a table</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={BILL_STATUS_LABELS[bill.status]} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatPoisa(bill.subtotalPoisa, { symbol })}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPoisa(chargesPoisa, { symbol })}</td>
                  <td className="px-3 py-2 price">{formatPoisa(bill.totalPoisa, { symbol })}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPoisa(bill.paidPoisa, { symbol })}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {outstandingPoisa > 0 ? (
                      <span className="font-semibold text-danger">{formatPoisa(outstandingPoisa, { symbol })}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 muted">
                    {formatInZone(bill.updatedAt, timeZone, { year: undefined })}
                    {bill.payments.length > 0 ? (
                      <span className="hint block">{bill.payments.length} payment(s) received</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/bills/${bill.id}`} className="btn btn-outline btn-sm">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </AdminTable>
        )}

        {!failure && (filters.page > 1 || pages > filters.page) ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {filters.page > 1 ? (
              <Link href={hrefFor(filters, { page: filters.page - 1 })} className="btn btn-ghost btn-sm">
                Previous page
              </Link>
            ) : null}
            {filters.page < pages ? (
              <Link href={hrefFor(filters, { page: filters.page + 1 })} className="btn btn-ghost btn-sm">
                Next page
              </Link>
            ) : null}
            <span className="hint self-center">
              {total} bill(s) on {filters.dateKey} in this view.
            </span>
          </div>
        ) : null}
      </Panel>

      {canSeePayments && !failure ? (
        <Panel
          title="Waiting on the bank"
          description="Online payments whose verified notification has not arrived. None of these count as received."
        >
          {waiting.length === 0 ? (
            <EmptyState title="Nothing is waiting on a gateway">
              Every online payment started by this till has a final outcome recorded against it.
            </EmptyState>
          ) : (
            <AdminTable head={["Reference", "Bill", "Method", "Amount", "Started", "State"]}>
              {waiting.map((payment) => (
                <tr key={payment.id} className="border-b border-line">
                  <td className="px-3 py-2 font-mono">{payment.reference}</td>
                  <td className="px-3 py-2 font-mono">{payment.bill?.number ?? "—"}</td>
                  <td className="px-3 py-2">
                    {PAYMENT_METHOD_LABELS[payment.method]}
                    {payment.isDemo ? <span className="badge badge-closed ml-2">Simulated</span> : null}
                  </td>
                  <td className="px-3 py-2 price">{formatPoisa(payment.amountPoisa, { symbol })}</td>
                  <td className="px-3 py-2 muted">{formatInZone(payment.createdAt, timeZone, { year: undefined })}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={PAYMENT_RECORD_LABELS[payment.status]} />
                    <div className="mt-1">
                      <PaymentStatusCheck reference={payment.reference} timeZone={timeZone} />
                    </div>
                  </td>
                </tr>
              ))}
            </AdminTable>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

export default function AdminBillsPage(props: PageProps<"/admin/bills">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <span className="skeleton block h-9 w-64" />
          <span className="skeleton block h-28" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="skeleton block h-24" />
            ))}
          </div>
          <span className="skeleton block h-80" />
        </div>
      }
    >
      <BillsView searchParams={props.searchParams} />
    </Suspense>
  );
}
