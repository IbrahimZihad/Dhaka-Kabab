import Link from "next/link";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatPoisa } from "@/lib/money";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { dayRange, formatInZone, todayKey } from "@/lib/time";
import { ORDER_STATUS_LABELS, TABLE_STATUS_LABELS } from "@/lib/staff-format";
import { orderUrlForTable, listTables } from "@/server/services/table.service";
import { listReservations } from "@/server/services/reservation.service";
import { ensureSettings } from "@/server/services/settings.service";
import { EmptyState, Note, Panel, Stat, StatusBadge } from "@/components/admin/admin-ui";
import { FloorAddTable } from "@/components/admin/floor-add-table";
import { FloorFilters } from "@/components/admin/floor-filters";
import { FloorTableActions, type FloorTableData } from "@/components/admin/floor-table-actions";

type SearchParams = PageProps<"/admin/floor">["searchParams"];

const STATUSES = Object.keys(TABLE_STATUS_LABELS) as (keyof typeof TABLE_STATUS_LABELS)[];

function filterValue(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function tileFor(
  table: FloorTableData["table"],
  orders: FloorTableData["orders"],
  billRequestedAt: string | null,
): FloorTableData {
  return { table, orders, billRequestedAt };
}

export async function FloorBoard({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "table:view")) {
    return (
      <Panel title="Kitchen staff" description="The floor board shows bills, so it is limited to the roles that run the room.">
        <p className="text-sm soft">
          Your screen is the <Link href="/kitchen" className="underline">kitchen display</Link>, where orders arrive as
          guests send them.
        </p>
      </Panel>
    );
  }

  const canManageTables = roleHasPermission(user.role, "table:manage");
  const canManageSessions = roleHasPermission(user.role, "table:session:manage");
  const canManageBills = roleHasPermission(user.role, "bill:manage");

  const params = await searchParams;
  const statusFilter = STATUSES.includes(params.status as keyof typeof TABLE_STATUS_LABELS) ? String(params.status) : "";
  const sectionFilter = filterValue(params.section);
  const searchFilter = filterValue(params.search).slice(0, 40);

  const [settings, tables] = await Promise.all([ensureSettings(), listTables({ includeDisabled: true })]);
  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;

  const sessionIds = tables.map((table) => table.activeSession?.id).filter((id): id is string => Boolean(id));

  const range = dayRange(todayKey(timeZone), timeZone);
  const [billRequests, sessionOrders, reservations] = await Promise.all([
    sessionIds.length
      ? prisma.tableSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, billRequestedAt: true } })
      : Promise.resolve([]),
    sessionIds.length
      ? prisma.order.findMany({
          where: { sessionId: { in: sessionIds }, status: { not: "CANCELLED" } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            sessionId: true,
            items: { select: { nameSnapshot: true, quantity: true } },
          },
        })
      : Promise.resolve([]),
    listReservations({ from: range.start, to: range.end }, { skip: 0, take: 200 }),
  ]);

  const requestedAt = new Map(billRequests.map((row) => [row.id, row.billRequestedAt]));
  const ordersBySession = new Map<string, typeof sessionOrders>();
  for (const order of sessionOrders) {
    if (!order.sessionId) continue;
    const list = ordersBySession.get(order.sessionId) ?? [];
    list.push(order);
    ordersBySession.set(order.sessionId, list);
  }

  const openableReservations = reservations.reservations
    .filter((reservation) => reservation.status === "PENDING" || reservation.status === "CONFIRMED")
    .map((reservation) => ({
      id: reservation.id,
      code: reservation.code,
      customerName: reservation.customerName,
      partySize: reservation.partySize,
    }));

  const freeTables = tables.filter((table) => table.isEnabled && !table.activeSession);
  const transferTargetsFor = (tableId: string) =>
    freeTables
      .filter((candidate) => candidate.id !== tableId)
      .map((candidate) => ({ id: candidate.id, label: candidate.label, capacity: candidate.capacity }));

  const sections = [...new Set(tables.map((table) => table.section).filter((value): value is string => Boolean(value)))].sort();
  const hasUnassigned = tables.some((table) => !table.section);

  const waitingForBill = tables.filter((table) => table.activeSession && requestedAt.get(table.activeSession.id)).length;
  const seated = tables.filter((table) => table.activeSession).length;

  const searchNeedle = searchFilter.toLowerCase();
  const rows = tables
    .filter((table) => {
      if (statusFilter && table.status !== statusFilter) return false;
      if (sectionFilter === "__unassigned") {
        if (table.section) return false;
      } else if (sectionFilter && table.section !== sectionFilter) {
        return false;
      }
      if (searchNeedle) {
        const inLabel = table.label.toLowerCase().includes(searchNeedle);
        const inSession = (table.activeSession?.code ?? "").toLowerCase().includes(searchNeedle);
        if (!inLabel && !inSession) return false;
      }
      return true;
    })
    .map((table) => {
      const session = table.activeSession;
      return tileFor(
        {
          id: table.id,
          label: table.label,
          number: table.number,
          capacity: table.capacity,
          section: table.section,
          status: table.status,
          isEnabled: table.isEnabled,
          orderUrl: orderUrlForTable(table.publicToken, env.appUrl),
          publicToken: table.publicToken,
          qrHref: `/api/admin/tables/${table.id}/qr`,
          session: session
            ? {
                id: session.id,
                code: session.code,
                openedAt: formatInZone(session.openedAt, timeZone),
                guestCount: session.guestCount,
                participants: session.participants,
                reservationCode: session.reservation?.code ?? null,
                billId: session.bill?.id ?? null,
                billNumber: session.bill?.number ?? null,
                billStatus: session.bill?.status ?? null,
                billTotal: session.bill ? formatPoisa(session.bill.totalPoisa, { symbol }) : null,
                outstanding: session.bill ? formatPoisa(session.outstandingPoisa, { symbol }) : null,
              }
            : null,
        },
        session
          ? (ordersBySession.get(session.id) ?? []).map((order) => ({
              id: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              items: order.items.map((item) => ({ name: item.nameSnapshot, quantity: item.quantity })),
            }))
          : [],
        session ? (requestedAt.get(session.id)?.toISOString() ?? null) : null,
      );
    });

  if (tables.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Floor</h1>
          <p className="hint mt-1">Every table in the room, its guests and its running bill.</p>
        </div>
        <EmptyState title="No tables have been set up yet">
          Until a table exists there is nothing to seat.{" "}
          {canManageTables
            ? "Add the first one below — it appears on this board straight away and gets its own ordering code and QR."
            : "A manager or owner can add one from this screen. Until then you can confirm the restaurant's details in settings."}
        </EmptyState>
        {canManageTables ? <FloorAddTable /> : null}
      </div>
    );
  }

  const filters = (
    <FloorFilters
      sections={sections}
      hasUnassigned={hasUnassigned}
      activeSection={sectionFilter}
      activeStatus={statusFilter}
      activeSearch={searchFilter}
    />
  );

  const waitingTables = tables.filter((table) => table.activeSession && requestedAt.get(table.activeSession.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Floor</h1>
          <p className="hint mt-1">
            Every table in the room. Times are the restaurant&apos;s own clock ({timeZone}); amounts are what a bill
            stands at now. Press reload for the freshest figures — this board does not update on its own.
          </p>
        </div>
        {filters}
      </div>

      {waitingTables.length > 0 ? (
        <Note kind="error">
          Waiting for the bill: {waitingTables.map((table) => table.label).join(", ")}. These tables have asked to be
          settled — take each bill forward from its tile below.
        </Note>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tables" value={tables.length} hint={`${seated} with guests seated`} />
        <Stat
          label="Waiting for the bill"
          value={waitingForBill}
          hint={waitingForBill > 0 ? "These tables asked to be settled." : "No table has asked yet."}
        />
        <Stat
          label="Out of service"
          value={tables.filter((table) => table.status === "DISABLED" || !table.isEnabled).length}
          hint="Disabled tables still show below so nothing is lost from view."
        />
        <Stat
          label="How to pay"
          value={<span className="text-base">Bills screen</span>}
          hint="This board never takes money; payments are recorded under Bills and payments."
        />
      </div>

      {canManageTables ? <FloorAddTable /> : null}

      {rows.length === 0 ? (
        <Note kind="info">
          No table matches the filters you have applied
          {statusFilter ? ` — status “${TABLE_STATUS_LABELS[statusFilter as keyof typeof TABLE_STATUS_LABELS]}”` : ""}
          {sectionFilter ? ` — ${sectionFilter === "__unassigned" ? "unassigned tables" : `section “${sectionFilter}”`}` : ""}
          {searchFilter ? ` — label or visit code containing “${searchFilter}”` : ""}.{" "}
          <Link href="/admin/floor" className="underline">
            Clear the filters
          </Link>
          .
        </Note>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <FloorTableCard
              key={row.table.id}
              data={row}
              can={{ manageTables: canManageTables, manageSessions: canManageSessions, manageBills: canManageBills }}
              transferTargets={transferTargetsFor(row.table.id)}
              reservations={openableReservations}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FloorTableCard({
  data,
  can,
  transferTargets,
  reservations,
}: {
  data: FloorTableData;
  can: { manageTables: boolean; manageSessions: boolean; manageBills: boolean };
  transferTargets: { id: string; label: string; capacity: number }[];
  reservations: { id: string; code: string; customerName: string; partySize: number }[];
}) {
  const { table, orders, billRequestedAt } = data;
  const statusLabel = TABLE_STATUS_LABELS[table.status as keyof typeof TABLE_STATUS_LABELS] ?? table.status;
  const session = table.session;

  return (
    <section className={`card p-5 ${billRequestedAt ? "border-2 border-danger" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Table {table.label}</h2>
          <p className="hint mt-1">
            {table.section ? table.section : "Unassigned section"} · seats {table.capacity} · no. {table.number}
            {!table.isEnabled ? " · disabled" : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={statusLabel} />
          {billRequestedAt ? <span className="badge badge-closed">Asking for the bill</span> : null}
        </div>
      </div>

      {session ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="soft">
            <span className="font-mono">{session.code}</span> · party of {session.guestCount}
            {session.guestCount === 1 ? "" : "s"} · {session.participants} device{session.participants === 1 ? "" : "s"}{" "}
            joined
            {session.reservationCode ? ` · booking ${session.reservationCode}` : ""}
          </p>
          <p className="hint">Seated {session.openedAt}.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-line px-3 py-2">
            <div>
              <p className="label">Bill total</p>
              <p className="price">{session.billTotal ?? "No bill drawn up yet"}</p>
            </div>
            <div>
              <p className="label">Outstanding</p>
              <p className="price">{session.outstanding ?? "—"}</p>
            </div>
            {session.billNumber ? (
              <div>
                <p className="label">Bill</p>
                <p className="soft">
                  {session.billNumber}
                  {session.billStatus ? ` (${session.billStatus.toLowerCase()})` : ""}
                </p>
              </div>
            ) : null}
          </div>

          <p className="label mt-2">Orders at this table</p>
          {orders.length === 0 ? (
            <p className="hint">Nothing has been sent for this visit yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((order) => (
                <li key={order.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div>
                    <Link
                      href={`/admin/orders?search=${encodeURIComponent(order.orderNumber)}`}
                      className="font-mono underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <p className="hint mt-0.5">
                      {order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ") || "no items recorded"}
                    </p>
                  </div>
                  <StatusBadge status={ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="hint mt-3">No party seated. Open a session to start a visit and its bill.</p>
      )}

      <FloorTableActions
        table={table}
        can={can}
        transferTargets={transferTargets}
        reservations={reservations}
        billRequestedAt={billRequestedAt}
      />
    </section>
  );
}

export function FloorBoardSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-56" />
        ))}
      </div>
    </div>
  );
}
