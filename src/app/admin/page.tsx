import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa } from "@/lib/money";
import { dashboardSnapshot } from "@/server/services/analytics.service";
import { providerReadiness } from "@/server/services/providers";
import { chatHealth } from "@/server/services/chatbot.service";
import { notificationHealth } from "@/server/services/notification.service";
import { ensureSettings } from "@/server/services/settings.service";
import { listOrders } from "@/server/services/order.service";
import { staffOrder } from "@/server/http/order-view";
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, TABLE_STATUS_LABELS } from "@/lib/staff-format";
import { EmptyState, Panel, Stat, StatusBadge } from "@/components/admin/admin-ui";

/**
 * Tickets still marked "preparing" from the last six hours. Six hours is past any
 * plausible cook time, so anything older than that is an abandoned ticket rather
 * than slow service. Read at request time, in the server component's own clock.
 */
function cookingWindow(): { from: Date } {
  return { from: new Date(Date.now() - 6 * 3600_000) };
}

async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "report:view")) {
    return (
      <Panel title="Kitchen staff" description="The overview shows takings, so it is limited to the roles that handle money.">
        <p className="text-sm soft">
          Your screen is the <Link href="/kitchen" className="underline">kitchen display</Link>, where orders arrive as
          guests send them.
        </p>
      </Panel>
    );
  }

  const [snapshot, gateway, chat, notifications, settings] = await Promise.all([
    dashboardSnapshot(),
    providerReadiness(),
    chatHealth(),
    notificationHealth(),
    ensureSettings(),
  ]);

  const realCollectedPoisa = snapshot.collectedTodayPoisa - snapshot.demoCollectedTodayPoisa;

  const attention: { label: string; href: string; when: boolean }[] = [
    { label: "The website has no address yet", href: "/admin/settings", when: !settings.addressLine1 },
    { label: "Opening hours are not set, so guests cannot see when you are open", href: "/admin/settings", when: !Array.isArray(settings.openingHours) || settings.openingHours.length === 0 },
    { label: "Online payment is not live", href: "/admin/settings", when: !gateway.available || !gateway.realCredentials },
    { label: "Payment is running on the simulated gateway", href: "/admin/settings", when: gateway.configured === "simulated" },
    { label: "Emailed receipts are switched off or SMTP is missing", href: "/admin/settings", when: !notifications.smtpConfigured || !notifications.enabledInSettings },
    { label: "The assistant has no AI model configured, so it only answers from the menu", href: "/admin/settings", when: chat.enabled && !chat.aiConfigured },
    { label: `${notifications.failed} notification(s) failed to send`, href: "/admin/settings", when: notifications.failed > 0 },
    { label: `${snapshot.pendingGatewayPayments} online payment(s) are still waiting on the bank`, href: "/admin/bills", when: snapshot.pendingGatewayPayments > 0 },
  ].filter((row) => row.when);

  const liveOrders = await listOrders({ status: "PREPARING", ...cookingWindow() }, { skip: 0, take: 6 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Today</h1>
        <p className="hint mt-1">
          {snapshot.dateKey} · the restaurant&apos;s own day, in {settings.timezone}. Figures cover orders taken since
          midnight; money is only counted as received when a payment was verified.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Billed today" value={snapshot.revenueTodayLabel} hint={`${snapshot.ordersToday} order(s) taken`} />
        <Stat
          label="Actually collected"
          value={formatPoisa(realCollectedPoisa, { symbol: settings.currencySymbol })}
          hint={
            snapshot.demoCollectedTodayPoisa > 0
              ? `${formatPoisa(snapshot.demoCollectedTodayPoisa, { symbol: settings.currencySymbol })} of that was the simulated gateway and is not real money`
              : "Counter and verified online payments"
          }
        />
        <Stat label="In the kitchen" value={snapshot.openOrders} hint={`${snapshot.readyForPickup} ready to serve`} />
        <Stat label="Bookings to honour" value={snapshot.reservationsToday} hint="Confirmed or awaiting confirmation" />
      </div>

      <Panel title="Needs someone's attention" description="Anything that would surprise a guest or lose money.">
        {attention.length === 0 ? (
          <EmptyState title="Nothing outstanding">Charges, hours, payments and messages are all configured.</EmptyState>
        ) : (
          <ul className="space-y-2 text-sm">
            {attention.map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-4 rounded-md border border-line px-3 py-2">
                <span>{row.label}</span>
                <Link href={row.href} className="btn btn-ghost btn-sm shrink-0">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Floor" description="Where every table is right now.">
          <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {Object.entries(TABLE_STATUS_LABELS).map(([status, label]) => (
              <li key={status} className="rounded-md border border-line px-3 py-2">
                <p className="label">{label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{snapshot.tables[status] ?? 0}</p>
              </li>
            ))}
          </ul>
          <p className="hint mt-3">
            <Link href="/admin/floor" className="underline">
              Open the floor board
            </Link>{" "}
            to seat a party, move a table or close a bill.
          </p>
        </Panel>

        <Panel title="Charges in force" description="What a bill adds on top of the food.">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="label">Service charge</dt>
              <dd className="soft">{snapshot.charges.serviceChargePercent}%</dd>
            </div>
            <div>
              <dt className="label">VAT</dt>
              <dd className="soft">
                {snapshot.charges.vatPercent}%{settings.vatOnServiceCharge ? " on food plus service charge" : " on food only"}
              </dd>
            </div>
            <div>
              <dt className="label">Average order</dt>
              <dd className="soft">{formatPoisa(snapshot.averageOrderPoisa, { symbol: settings.currencySymbol })}</dd>
            </div>
            <div>
              <dt className="label">Payments</dt>
              <dd className="soft">{gateway.label}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="Still cooking" description="Orders marked as being prepared in the last six hours.">
        {liveOrders.orders.length === 0 ? (
          <EmptyState title="Nothing in the kitchen right now" />
        ) : (
          <ul className="divide-y divide-line">
            {liveOrders.orders.map((order) => {
              const view = staffOrder(order, settings.currencySymbol, { financials: false });
              const itemCount = view.items.reduce((total, item) => total + item.quantity, 0);
              return (
                <li key={view.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-mono">{view.orderNumber}</span>
                  <span className="muted">
                    {ORDER_TYPE_LABELS[view.type as keyof typeof ORDER_TYPE_LABELS] ?? view.type} ·{" "}
                    {view.table ? `table ${view.table}` : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
                  </span>
                  <StatusBadge status={ORDER_STATUS_LABELS[view.status as keyof typeof ORDER_STATUS_LABELS] ?? view.status} />
                  <Link href={`/admin/orders?search=${encodeURIComponent(view.orderNumber)}`} className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <span className="skeleton block h-9 w-40" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="skeleton block h-24" />
            ))}
          </div>
          <span className="skeleton block h-64" />
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
