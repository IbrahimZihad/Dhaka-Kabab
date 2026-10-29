import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewKitchenFinancials, roleHasPermission, type Permission } from "@/lib/auth/rbac";
import { BILL_STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_FLOW, ORDER_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/staff-format";
import { formatPoisa } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { AppError } from "@/lib/errors";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrderById, isTransitionAllowed } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { staffOrder } from "@/server/http/order-view";
import { orUnset } from "@/server/http/site";
import { Details, Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { OrderStatusControls } from "@/components/admin/order-status-controls";
import { OrderCancelForm } from "@/components/admin/order-cancel-form";
import { OrderSettleButton } from "@/components/admin/order-settle-button";

export const metadata: Metadata = { title: "Order" };

/**
 * Which permission each step needs. Mirrors the endpoint at
 * /api/orders/[id]/status, so a button is only offered for a move the server
 * would accept from this role. Cancellation is absent on purpose: it has its own
 * endpoint and its own reason requirement.
 */
const PERMISSION_BY_STATUS: Record<string, Permission> = {
  CONFIRMED: "order:status:floor",
  PREPARING: "order:status:kitchen",
  READY: "order:status:kitchen",
  SERVED: "order:status:floor",
  COMPLETED: "order:status:floor",
};

function typeLabel(type: string): string {
  return ORDER_TYPE_LABELS[type as keyof typeof ORDER_TYPE_LABELS] ?? type;
}

function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? status;
}

async function OrderDetailBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "order:view:any")) {
    return (
      <Panel title="One order" description="This section belongs to the roles that handle orders.">
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

  const financials = canViewKitchenFinancials(user.role);
  const maySeeBills = roleHasPermission(user.role, "bill:view");

  let order: Awaited<ReturnType<typeof getOrderById>> | null = null;
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  let bill: { id: string; number: string; status: keyof typeof BILL_STATUS_LABELS } | null = null;
  let failure: string | null = null;

  try {
    [order, settings] = await Promise.all([getOrderById(id), getSettings()]);
    if (maySeeBills) {
      // Neither the order projection nor any endpoint answers "which bill is this
      // order on", so it is read here rather than invented on the screen.
      const found = await prisma.bill.findFirst({
        where: { OR: [{ orderId: order.id }, { orders: { some: { orderId: order.id } } }] },
        select: { id: true, number: true, status: true },
        orderBy: { createdAt: "desc" },
      });
      bill = found;
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    failure = error instanceof AppError ? error.message : "This order could not be read.";
  }

  if (failure) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Order</h1>
        <Note kind="error">
          {failure} Nothing was changed.{" "}
          <Link href="/admin/orders" className="underline">
            Back to the orders list
          </Link>
          .
        </Note>
      </div>
    );
  }

  if (!order || !settings) return null;

  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;
  const orderStatus = order.status;
  const view = staffOrder(order, symbol, { financials });
  // The projection itself is the record of what this role may see: money, the
  // guest's name and number and the delivery address only exist on it when the
  // server put them there.
  const withMoney = "money" in view ? view : null;
  const money = withMoney?.money ?? null;
  const dishes = view.items.reduce((total, item) => total + item.quantity, 0);

  const transitions = ORDER_STATUS_FLOW.filter((to) => {
    const permission = PERMISSION_BY_STATUS[to];
    return permission !== undefined && isTransitionAllowed(orderStatus, to, user.role) && roleHasPermission(user.role, permission);
  }).map((to) => ({ status: to, label: ORDER_STATUS_LABELS[to] }));

  const mayCancel = roleHasPermission(user.role, "order:cancel") && isTransitionAllowed(orderStatus, "CANCELLED", user.role);
  const maySettle = roleHasPermission(user.role, "bill:manage") && orderStatus !== "CANCELLED";

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Type", value: typeLabel(view.type) },
    { label: "Where", value: view.table ? `Table ${view.table}` : "Not a table" },
    { label: "Taken", value: formatInZone(new Date(view.createdAt), timeZone) },
    { label: "Ready at", value: view.readyAt ? formatInZone(new Date(view.readyAt), timeZone) : "not ready yet" },
    {
      label: "Payment",
      value: PAYMENT_STATUS_LABELS[view.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS] ?? view.paymentStatus,
    },
    { label: "Dishes", value: `${dishes} item${dishes === 1 ? "" : "s"}` },
  ];

  if (withMoney) {
    rows.push({ label: "Guest", value: orUnset(withMoney.guest) });
    rows.push({ label: "Phone", value: orUnset(withMoney.phone) });
    if (withMoney.type === "DELIVERY") rows.push({ label: "Delivery address", value: orUnset(withMoney.deliveryAddress) });
    rows.push({
      label: "Bill",
      value: bill ? (
        <Link href={`/admin/bills/${bill.id}`} className="underline">
          {bill.number} · {BILL_STATUS_LABELS[bill.status]}
        </Link>
      ) : (
        orUnset(null, "not on a bill yet")
      ),
    });
  }

  if (view.sessionId) {
    rows.push({
      label: "This visit",
      value: (
        <Link href={`/admin/orders?sessionId=${encodeURIComponent(view.sessionId)}`} className="underline">
          other orders from the same sitting
        </Link>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/admin/orders" className="hover:text-brand">
          Orders
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{view.orderNumber}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{view.orderNumber}</h1>
          <p className="hint mt-1">
            {typeLabel(view.type)}
            {view.table ? ` · table ${view.table}` : ""} · taken {formatInZone(new Date(view.createdAt), timeZone)} ·{" "}
            {dishes} item{dishes === 1 ? "" : "s"}
            {view.isDemo ? " · sample order" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={statusLabel(view.status)} />
          {maySettle ? <OrderSettleButton orderId={view.id} /> : null}
          {withMoney ? (
            <Link href={`/track/${withMoney.trackToken}`} className="btn btn-ghost btn-sm">
              Guest&apos;s own status page
            </Link>
          ) : null}
        </div>
      </div>

      {view.cancelledReason ? (
        <Note kind="error">Cancelled: {view.cancelledReason}</Note>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Dishes" description="As the guest sent them, with the choices made on each line.">
          {view.items.length === 0 ? (
            <p className="hint">No dishes were recorded on this order.</p>
          ) : (
            <ul className="divide-y divide-line">
              {view.items.map((item) => (
                <li key={item.id} className="py-2 text-sm">
                  <p className="font-semibold">
                    {item.quantity} × {item.name}
                  </p>
                  <p className="hint mt-0.5">{item.options.length > 0 ? item.options.join(", ") : "no options chosen"}</p>
                  {item.instructions ? <p className="notice mt-1">Kitchen note: {item.instructions}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {view.specialInstructions ? (
            <p className="notice mt-3">Whole order: {view.specialInstructions}</p>
          ) : null}
          {view.internalNote ? <p className="hint mt-2">Staff note: {view.internalNote}</p> : null}
        </Panel>

        <Panel title="The order" description="Contact and delivery details follow your role.">
          <Details rows={rows} />
        </Panel>
      </div>

      {money ? (
        <Panel title="Totals" description="Every figure is the server's own; nothing here is recalculated.">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {[
              { label: "Subtotal", value: formatPoisa(money.subtotalPoisa, { symbol }) },
              { label: "Discount", value: formatPoisa(money.discountPoisa, { symbol }) },
              { label: "Service charge", value: formatPoisa(money.serviceChargePoisa, { symbol }) },
              { label: "VAT", value: formatPoisa(money.vatPoisa, { symbol }) },
              { label: "Delivery fee", value: formatPoisa(money.deliveryFeePoisa, { symbol }) },
              { label: "Total", value: formatPoisa(money.totalPoisa, { symbol }) },
              { label: "Paid", value: formatPoisa(money.paidPoisa, { symbol }) },
              { label: "Outstanding", value: formatPoisa(money.outstandingPoisa, { symbol }) },
            ].map((row) => (
              <div key={row.label}>
                <dt className="label">{row.label}</dt>
                <dd className="price mt-0.5">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="hint mt-3">
            {maySettle ? (
              <>
                &ldquo;Bill &amp; take payment&rdquo; at the top raises this order&rsquo;s bill and opens the till screen:
                one place to fix the amount, take the money and hand over the receipt.
              </>
            ) : (
              <>
                Take and settle the money on{" "}
                <Link href="/admin/bills" className="underline">
                  bills and payments
                </Link>
                .
              </>
            )}
          </p>
        </Panel>
      ) : null}

      <Panel title="Move this order" description="Each step is checked again by the server when you press it.">
        <OrderStatusControls orderId={view.id} orderNumber={view.orderNumber} transitions={transitions} />
        {mayCancel ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="label">Cancel</h3>
            <p className="hint mt-1">A reason is required and is kept on the record.</p>
            <div className="mt-3">
              <OrderCancelForm orderId={view.id} orderNumber={view.orderNumber} />
            </div>
          </div>
        ) : !roleHasPermission(user.role, "order:cancel") ? (
          <p className="hint mt-4">
            Cancelling an order needs the counter or management permission, which this role does not carry.
          </p>
        ) : null}
      </Panel>

      <Panel title="Status history" description="Every step, in the restaurant's own time.">
        {view.timeline.length === 0 ? (
          <p className="hint">Nothing has been recorded for this order yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {view.timeline.map((event, index) => (
              <li key={`${event.status}-${index}`} className="flex flex-wrap items-center justify-between gap-3">
                <StatusBadge status={statusLabel(event.status)} />
                <span className="muted">{formatInZone(new Date(event.at), timeZone)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

export default function AdminOrderDetailPage(props: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <span className="skeleton block h-6 w-48" />
          <span className="skeleton block h-10 w-64" />
          <div className="grid gap-6 lg:grid-cols-2">
            <span className="skeleton block h-56" />
            <span className="skeleton block h-56" />
          </div>
          <span className="skeleton block h-40" />
        </div>
      }
    >
      <OrderDetailBody params={props.params} />
    </Suspense>
  );
}
