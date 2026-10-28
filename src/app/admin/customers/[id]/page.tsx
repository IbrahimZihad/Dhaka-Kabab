import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { formatPoisa } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
} from "@/lib/staff-format";
import { getCustomerProfile } from "@/server/services/customer.service";
import { orUnset, siteContext } from "@/server/http/site";
import { Details, EmptyState, Note, Panel } from "@/components/admin/admin-ui";
import { CustomerEditForm } from "@/components/admin/customer-edit-form";

export const metadata: Metadata = { title: "Customer" };

function ProfileSkeleton() {
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

/** A dish line for an order, capped so a long basket cannot swamp the row. */
function itemSummary(items: { nameSnapshot: string; quantity: number }[]): string {
  if (items.length === 0) return "No items recorded";
  const shown = items.slice(0, 4).map((item) => `${item.nameSnapshot} ×${item.quantity}`);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} (+${rest} more)` : shown.join(", ");
}

async function CustomerDetailBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "customer:view")) {
    return (
      <Panel title="One customer" description="The customer book holds diners' contact details, so it belongs to the roles that serve them.">
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

  let notFound = false;
  let failure: string | null = null;
  let profile: Awaited<ReturnType<typeof getCustomerProfile>> | null = null;

  try {
    profile = await getCustomerProfile(id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      notFound = true;
    } else {
      failure = error instanceof AppError ? error.message : "This customer could not be read.";
    }
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Customer</h1>
        <EmptyState title="No such customer">
          The record you asked for is not in the book — it was removed, or the link is out of date. Nothing was changed.{" "}
          <Link href="/admin/customers" className="underline">
            Back to the customer book
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  if (failure) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Customer</h1>
        <Note kind="error">
          {failure} Nothing was changed.{" "}
          <Link href="/admin/customers" className="underline">
            Back to the customer book
          </Link>
          .
        </Note>
      </div>
    );
  }

  if (!profile) return null;

  const { customer, totals, orders, reservations } = profile;
  const { money, timeZone } = await siteContext();
  const symbol = money.currencySymbol;

  const profileRows = [
    { label: "Email", value: <span className="break-all">{customer.email}</span> },
    { label: "Phone", value: orUnset(customer.phone) },
    { label: "Account", value: customer.isActive ? "Active" : "Deactivated" },
    { label: "Address", value: orUnset(customer.address) },
    { label: "Internal note", value: orUnset(customer.notes, "No note") },
    { label: "Joined", value: formatInZone(customer.createdAt, timeZone) },
    { label: "Last sign-in", value: customer.lastLoginAt ? formatInZone(customer.lastLoginAt, timeZone) : "Never signed in" },
    { label: "Orders", value: `${totals.orders} (all time, cancelled left out)` },
    { label: "Spend", value: totals.spendLabel },
    { label: "Last order", value: totals.lastOrderAt ? formatInZone(totals.lastOrderAt, timeZone) : "No orders yet" },
  ];

  return (
    <div className="space-y-6">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/admin/customers" className="hover:text-brand">
          Customers
        </Link>
        <span className="mx-2">/</span>
        <span>{customer.name}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
          <p className="hint mt-1">
            {totals.orders} order{totals.orders === 1 ? "" : "s"} totalling {totals.spendLabel} ·{" "}
            {customer.isActive ? "active account" : "deactivated account"}
            {totals.lastOrderAt ? ` · last order ${formatInZone(totals.lastOrderAt, timeZone)}` : " · no orders recorded"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={customer.isActive ? "badge badge-open" : "badge badge-closed"}>{customer.isActive ? "Active" : "Deactivated"}</span>
          <Link href="/admin/customers" className="btn btn-ghost btn-sm">
            Customer book
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile" description="Stored facts only — anything never recorded says so. Spend is read from the customer's own orders, never typed in.">
          <Details rows={profileRows} />
        </Panel>

        {mayManage ? (
          <Panel
            title="Edit this customer"
            description="Sent to the customer endpoint; the server re-checks the number and refuses a phone another account already uses. Nothing is reported as saved until it answers."
          >
            <CustomerEditForm
              customer={{
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                address: customer.address,
                notes: customer.notes,
                isActive: customer.isActive,
              }}
            />
          </Panel>
        ) : (
          <Panel title="Editing" description="Changing a customer needs the customer-management permission.">
            <p className="text-sm soft">
              Your role can read this record but not change it. Ask a manager or owner to correct the name, number,
              address or note, or to activate or deactivate the account.
            </p>
          </Panel>
        )}
      </div>

      <Panel
        title="Order history"
        description={
          orders.length === 0
            ? "Nothing ordered under this account."
            : `Up to the 50 most recent orders placed with this account. Totals are the stored bill, on the restaurant's clock (${timeZone}).`
        }
      >
        {orders.length === 0 ? (
          <EmptyState title="No orders yet">This account has not placed an order, so there is nothing to sum.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/admin/orders?search=${encodeURIComponent(order.orderNumber)}`} className="font-mono font-semibold hover:text-brand">
                    {order.orderNumber}
                  </Link>{" "}
                  <span className="muted">
                    · {ORDER_TYPE_LABELS[order.type as keyof typeof ORDER_TYPE_LABELS] ?? order.type} ·{" "}
                    {order.table ? `table ${order.table.label}` : "no table"} · {formatInZone(order.createdAt, timeZone)}
                  </span>
                  <p className="muted truncate">{itemSummary(order.items)}</p>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <span className="badge">
                    {PAYMENT_STATUS_LABELS[order.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS] ?? order.paymentStatus}
                  </span>
                  <span className="badge">
                    {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
                  </span>
                  <span className="price tabular-nums whitespace-nowrap">{formatPoisa(order.totalPoisa, { symbol })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Bookings"
        description={
          reservations.length === 0
            ? "No table bookings recorded under this account."
            : "Reservations linked to this account, soonest arrival last."
        }
      >
        {reservations.length === 0 ? (
          <EmptyState title="No bookings">This account has never booked a table.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {reservations.map((reservation) => (
              <li key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <Link href={`/admin/reservations/${reservation.id}`} className="font-mono font-semibold hover:text-brand">
                    {reservation.code}
                  </Link>{" "}
                  <span className="muted">
                    · {reservation.partySize} guest{reservation.partySize === 1 ? "" : "s"} ·{" "}
                    {formatInZone(reservation.startsAt, timeZone)}
                    {reservation.tables.length > 0
                      ? ` · table ${reservation.tables.map((assignment) => assignment.table.label).join(", ")}`
                      : " · no table allocated"}
                  </span>
                </span>
                <span className="badge">
                  {RESERVATION_STATUS_LABELS[reservation.status as keyof typeof RESERVATION_STATUS_LABELS] ?? reservation.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function AdminCustomerDetailPage(props: PageProps<"/admin/customers/[id]">) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <CustomerDetailBody params={props.params} />
    </Suspense>
  );
}
