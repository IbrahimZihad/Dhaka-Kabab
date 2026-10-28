import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS, roleHasPermission } from "@/lib/auth/rbac";
import { paginate } from "@/lib/api";
import { formatPoisa } from "@/lib/money";
import { dayRange, formatInZone, todayKey } from "@/lib/time";
import { getSettings } from "@/server/services/settings.service";
import { auditActionSummary, auditTrailFor, listAuditLogs } from "@/server/services/audit.service";
import { AdminTable, EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";

export const metadata: Metadata = { title: "Audit log" };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The list keys the address bar can carry — the same set the endpoint accepts. */
const FILTER_KEYS = [
  "action",
  "entityType",
  "entityId",
  "actorUserId",
  "from",
  "to",
  "page",
  "pageSize",
  "trailType",
  "trailId",
] as const;

/**
 * Display-side block list. `writeAudit` already redacts anything credential
 * shaped before storing it (src/lib/audit.ts), so nothing here should ever be
 * secret. This is the second lock on the door, and it also catches the names the
 * first list misses: `paymentStoreId` identifies a merchant account at the bank,
 * which is not something an audit browser needs printed.
 */
const DO_NOT_DISPLAY =
  /password|passwd|secret|token|apikey|api_key|authorization|cookie|cardnumber|card_number|cvv|cvc|hash|signature|storeid|store_id|credential/i;

/** Entity types this build writes, with the plain word a manager uses for them. */
const ENTITY_LABELS: Record<string, string> = {
  Bill: "Bill",
  ChatConversation: "Chat",
  Media: "Uploaded image",
  MenuCategory: "Menu section",
  MenuItem: "Dish",
  MenuItemCustomizationGroup: "Choice group",
  Order: "Order",
  Payment: "Payment",
  Refund: "Refund",
  Reservation: "Booking",
  RestaurantSettings: "Restaurant settings",
  RestaurantTable: "Table",
  TableSession: "Table visit",
  User: "Account",
};

/** Sections that have a real page for one record of this type. */
const RECORD_PAGES: Record<string, string> = {
  Bill: "/admin/bills",
  MenuItem: "/admin/menu",
  Order: "/admin/orders",
  Reservation: "/admin/reservations",
};

const PAGE_SIZES = [25, 50, 100, 200];

type AuditEntry = Awaited<ReturnType<typeof listAuditLogs>>["logs"][number];
type TrailEntry = Awaited<ReturnType<typeof auditTrailFor>>[number];

/** The fields both reads return, so one renderer serves the table and the trail. */
type LogLine = AuditEntry | TrailEntry;

function single(raw: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

/** A day the restaurant's clock can bound. Nonsense is refused, never guessed at. */
function validDateKey(value: string | undefined): string | undefined {
  if (!value || !DATE_PATTERN.test(value)) return undefined;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? undefined : value;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Two stored values are the same when their content is; used to work out which
 * fields an entry actually changed instead of repeating a whole row back.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** One stored value, said plainly. Nothing reaches the browser as raw JSON. */
function Value({
  name,
  value,
  depth,
  timeZone,
  symbol,
}: {
  name: string;
  value: unknown;
  depth: number;
  timeZone: string;
  symbol: string;
}) {
  if (DO_NOT_DISPLAY.test(name)) {
    return (
      <span className="badge badge-closed">
        withheld — “{name}” names a credential
      </span>
    );
  }

  if (value === null || value === undefined) return <span className="muted">nothing</span>;

  if (typeof value === "boolean") {
    if (name === "isDemo") {
      return (
        <span>
          {value ? "yes" : "no"}
          {value ? <span className="hint block">the simulated gateway handled this — it is not real money</span> : null}
        </span>
      );
    }
    return <span>{value ? "yes" : "no"}</span>;
  }

  if (typeof value === "number") {
    // Money is stored as integer poisa; both readings are shown so a figure can
    // be checked against the database without a calculator.
    if (/poisa$/i.test(name) && Number.isInteger(value)) {
      return (
        <span>
          <span className="price">{formatPoisa(value, { symbol })}</span>
          <span className="muted block">{value} poisa</span>
        </span>
      );
    }
    return <span className="tabular-nums">{value}</span>;
  }

  if (typeof value === "string") {
    if (ISO_INSTANT.test(value)) {
      const asDate = new Date(value);
      if (!Number.isNaN(asDate.getTime())) {
        return (
          <span title={asDate.toISOString()}>
            {formatInZone(asDate, timeZone)}
            <span className="muted block">{asDate.toISOString()}</span>
          </span>
        );
      }
    }
    if (value === "") return <span className="muted">blank</span>;
    return <span>{value.length > 300 ? `${value.slice(0, 300)}…` : value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">none</span>;
    if (value.every((item) => item === null || typeof item !== "object")) {
      const text = value.map((item) => String(item)).join(", ");
      return <span>{text.length > 400 ? `${text.slice(0, 400)}…` : text}</span>;
    }
    if (depth >= 3) return <span className="muted">{value.length} item(s) — too deep to print here</span>;
    return (
      <ul className="space-y-2">
        {value.slice(0, 25).map((item, index) => (
          <li key={index} className="border-l border-line pl-3">
            <p className="label">Item {index + 1}</p>
            <Fields object={item} depth={depth + 1} timeZone={timeZone} symbol={symbol} />
          </li>
        ))}
        {value.length > 25 ? <li className="hint">…and {value.length - 25} more not shown</li> : null}
      </ul>
    );
  }

  if (isRecord(value)) return <Fields object={value} depth={depth} timeZone={timeZone} symbol={symbol} />;

  return <span className="muted">not shown</span>;
}

/** A stored object, one labelled line per field, in a stable order. */
function Fields({
  object,
  depth,
  timeZone,
  symbol,
}: {
  object: unknown;
  depth: number;
  timeZone: string;
  symbol: string;
}) {
  if (Array.isArray(object)) return <Value name="items" value={object} depth={depth} timeZone={timeZone} symbol={symbol} />;
  if (!isRecord(object)) return <Value name="value" value={object} depth={depth} timeZone={timeZone} symbol={symbol} />;

  const keys = Object.keys(object).sort();
  if (keys.length === 0) return <span className="muted">nothing stored</span>;

  return (
    <dl className="grid gap-2">
      {keys.map((key) => (
        <div key={key} className="grid grid-cols-[9rem_1fr] gap-2">
          <dt className="label break-words">{key}</dt>
          <dd className="soft break-words">
            <Value name={key} value={object[key]} depth={depth} timeZone={timeZone} symbol={symbol} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What an entry changed. Where both halves are stored, only the fields that
 * differ are repeated back — a settings entry carries forty columns and an
 * auditor wants the three that moved, not all forty.
 */
function EntryDetail({ entry, timeZone, symbol }: { entry: LogLine; timeZone: string; symbol: string }) {
  const before = entry.beforeJson;
  const after = entry.afterJson;
  const meta = entry.metaJson;
  const comparable = isRecord(before) && isRecord(after);

  const changed = new Set<string>();
  if (comparable) {
    for (const key of Object.keys(after)) {
      if (!sameValue(before[key], after[key])) changed.add(key);
    }
  }
  const changedKeys = [...changed].sort();

  return (
    <div className="space-y-3 text-sm">
      <p className="muted">
        Recorded at {formatInZone(entry.createdAt, timeZone, { second: "2-digit" })} in {timeZone} —{" "}
        <span className="font-mono">{entry.createdAt.toISOString()}</span>
      </p>

      {comparable ? (
        <div>
          <p className="label">Changed here</p>
          {changedKeys.length === 0 ? (
            <p className="soft">Nothing differs between the two copies. The entry marks the moment, not a difference.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {changedKeys.slice(0, 40).map((key) => (
                <li key={key} className="rounded-md border border-line px-3 py-2">
                  <p className="label break-words">{key}</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <p>
                      <span className="label">Was</span>
                      <span className="soft block break-words">
                        <Value name={key} value={before[key]} depth={1} timeZone={timeZone} symbol={symbol} />
                      </span>
                    </p>
                    <p>
                      <span className="label">Now</span>
                      <span className="soft block break-words">
                        <Value name={key} value={after[key]} depth={1} timeZone={timeZone} symbol={symbol} />
                      </span>
                    </p>
                  </div>
                </li>
              ))}
              {changedKeys.length > 40 ? <li className="hint">…and {changedKeys.length - 40} more field(s) not printed.</li> : null}
            </ul>
          )}
          <p className="hint mt-2">
            {Math.max(0, Object.keys(after).length - changedKeys.length)} other field(s) in these copies were already
            the same and are not repeated.
          </p>
        </div>
      ) : null}

      {!comparable && before === undefined && after === undefined && meta === undefined ? (
        <p className="soft">
          This entry records the action alone. Nothing was stored about what it changed — some actions only note that
          they happened.
        </p>
      ) : null}

      {!comparable && before !== undefined && before !== null ? (
        <div>
          <p className="label">Before</p>
          <Fields object={before} depth={0} timeZone={timeZone} symbol={symbol} />
        </div>
      ) : null}

      {!comparable && after !== undefined && after !== null ? (
        <div>
          <p className="label">After</p>
          <Fields object={after} depth={0} timeZone={timeZone} symbol={symbol} />
        </div>
      ) : null}

      {meta !== undefined && meta !== null ? (
        <div>
          <p className="label">Notes taken with the entry</p>
          <Fields object={meta} depth={0} timeZone={timeZone} symbol={symbol} />
        </div>
      ) : null}

      {"entityType" in entry ? (
        <p className="hint">
          Against {ENTITY_LABELS[entry.entityType] ?? entry.entityType} ·{" "}
          <span className="font-mono break-all">{entry.entityId ?? "no id stored on this entry"}</span>
        </p>
      ) : null}
    </div>
  );
}

function actorLine(entry: LogLine): { who: string; role: string; email: string | null } {
  if (entry.actor) return { who: entry.actor.name, role: ROLE_LABELS[entry.actor.role], email: entry.actor.email };
  if (entry.actorType === "GUEST") {
    return { who: entry.actorLabel ?? "a guest at a table", role: "Guest, no account", email: null };
  }
  if (entry.actorType === "SYSTEM") {
    return { who: entry.actorLabel ?? "the system itself", role: "System", email: null };
  }
  // The account link is cleared when an account row is deleted, while the entry
  // itself stays. So this says exactly that, rather than naming someone.
  return {
    who: entry.actorLabel ?? "an account that is no longer in the register",
    role: "Signed-in account, link cleared",
    email: null,
  };
}

function ActorCell({ entry }: { entry: LogLine }) {
  const actor = actorLine(entry);
  return (
    <td className="px-3 py-2 align-top">
      <span className="font-semibold">{actor.who}</span>
      <span className="muted block">{actor.role}</span>
      {actor.email ? <span className="hint block break-all">{actor.email}</span> : null}
      {entry.actorType !== "USER" ? <span className="badge inline-block">{entry.actorType.toLowerCase()}</span> : null}
    </td>
  );
}

function EntityCell({ entry }: { entry: LogLine }) {
  const type = "entityType" in entry ? entry.entityType : undefined;
  const id = "entityId" in entry ? entry.entityId : null;
  const label = type ? (ENTITY_LABELS[type] ?? type) : "no kind stored";
  const page = type && id ? RECORD_PAGES[type] : undefined;
  return (
    <td className="px-3 py-2 align-top">
      <span>{label}</span>
      <span className="muted block break-all font-mono text-xs">{id ?? "—"}</span>
      {page && id ? (
        <Link href={`${page}/${id}`} className="btn btn-ghost btn-sm mt-1">
          Open it
        </Link>
      ) : null}
    </td>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-48" />
      <span className="skeleton block h-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <span className="skeleton block h-96" />
    </div>
  );
}

/** Names the window in the restaurant's own days, so nobody misreads a UTC bound. */
function WindowLabel({ from, to, timeZone }: { from: Date | undefined; to: Date | undefined; timeZone: string }) {
  const dayOf = (instant: Date) => formatInZone(instant, timeZone, { hour: undefined, minute: undefined });
  // The end bound is the first instant of the next local day, so the day it
  // belongs to is the one before it.
  const lastIncluded = (instant: Date) => dayOf(new Date(instant.getTime() - 86_400_000));
  if (from && to) return <>{`${dayOf(from)} to ${lastIncluded(to)}, both days included`}</>;
  if (from) return <>from {dayOf(from)} onward, no end date set</>;
  if (to) return <>up to {lastIncluded(to)}, no start date set</>;
  return <>no date limit</>;
}

async function AuditBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  // ---- The gate. Nothing below runs for a role that may not read the log.
  if (!roleHasPermission(user.role, "audit:view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
        <Panel
          title="Not on your screen"
          description="The log names the people who changed the restaurant's records, so it is read by the two roles that can be asked about those changes."
        >
          <p className="text-sm soft">
            You are signed in as {ROLE_LABELS[user.role]}. That role is not given the log, so no entries, no counts and
            no names are shown here at all. Only {ROLE_LABELS.MANAGER} and {ROLE_LABELS.OWNER} read it, and the
            endpoint behind this screen refuses every other role in the same words.
          </p>
          <p className="hint mt-3">
            What you do is still written down with your name and the time — you are simply not a reader of that record.
          </p>
        </Panel>
      </div>
    );
  }

  const settings = await getSettings();
  const timeZone = settings.timezone;
  const symbol = settings.currencySymbol;
  const raw = await searchParams;

  const action = single(raw, "action")?.slice(0, 60);
  const entityType = single(raw, "entityType")?.slice(0, 40);
  const entityId = single(raw, "entityId")?.slice(0, 64);
  const actorUserId = single(raw, "actorUserId")?.slice(0, 64);

  const askedFrom = single(raw, "from");
  const askedTo = single(raw, "to");
  const fromKey = validDateKey(askedFrom);
  const toKey = validDateKey(askedTo);
  const ignoredFrom = askedFrom !== undefined && fromKey === undefined;
  const ignoredTo = askedTo !== undefined && toKey === undefined;

  // Exactly the endpoint's contract: a window with neither end set is the
  // restaurant's own trading day, so an unfiltered read cannot stream the whole
  // history into a browser. One end given is honoured as given, leaving the
  // other open.
  const bounded = Boolean(fromKey ?? toKey);
  const today = dayRange(todayKey(timeZone), timeZone);
  const from = fromKey ? dayRange(fromKey, timeZone).start : bounded ? undefined : today.start;
  const to = toKey ? dayRange(toKey, timeZone).end : bounded ? undefined : today.end;

  const { page, pageSize, skip, take } = paginate(
    { page: positiveInt(single(raw, "page")), pageSize: positiveInt(single(raw, "pageSize")) },
    { pageSize: 50, max: 200 },
  );

  // Per-record trail. The endpoint asks for three to forty characters of type and
  // one to sixty-four of id; the same rule is applied here rather than guessed at.
  const trailTypeRaw = single(raw, "trailType");
  const trailIdRaw = single(raw, "trailId");
  const trailType =
    trailTypeRaw && trailTypeRaw.length >= 3 && trailTypeRaw.length <= 40 ? trailTypeRaw : undefined;
  const trailId = trailIdRaw && trailIdRaw.length <= 64 ? trailIdRaw : undefined;
  const trailAsked = Boolean(trailTypeRaw || trailIdRaw);
  const trailReady = Boolean(trailType && trailId);

  const current: Record<string, string | undefined> = {
    action,
    entityType,
    entityId,
    actorUserId,
    from: fromKey,
    to: toKey,
    page: page > 1 ? String(page) : undefined,
    pageSize: pageSize !== 50 ? String(pageSize) : undefined,
    trailType,
    trailId,
  };

  /** Rebuilds the address with one or two values changed; null removes one. */
  function hrefFor(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const override = overrides[key];
      const value = override === undefined ? current[key] : override;
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/admin/audit?${query}` : "/admin/audit";
  }

  const active: { key: string; label: string; value: string }[] = [];
  if (action) active.push({ key: "action", label: "Action starts with", value: action });
  if (entityType) active.push({ key: "entityType", label: "Kind of record", value: ENTITY_LABELS[entityType] ?? entityType });
  if (entityId) active.push({ key: "entityId", label: "Record id", value: entityId });
  if (actorUserId) active.push({ key: "actorUserId", label: "By one account", value: actorUserId.slice(0, 12) });
  if (fromKey) active.push({ key: "from", label: "From", value: fromKey });
  if (toKey) active.push({ key: "to", label: "To", value: toKey });

  let failure: string | null = null;
  let logs: AuditEntry[] = [];
  let total = 0;
  let summary: Awaited<ReturnType<typeof auditActionSummary>> = [];
  let trail: TrailEntry[] = [];

  try {
    const [listed, counted] = await Promise.all([
      listAuditLogs({ action, entityType, entityId, actorUserId, from, to }, { skip, take }),
      from && to ? auditActionSummary({ from, to }) : Promise.resolve([]),
    ]);
    logs = listed.logs;
    total = listed.total;
    summary = counted;
    if (trailReady) trail = await auditTrailFor(trailType as string, trailId as string);
  } catch (error) {
    failure = error instanceof Error ? error.message : "The audit log could not be read.";
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Who appears on this page, offered as filters because the endpoint's actor
  // filter takes an id and nobody remembers a cuid.
  const observedActors = new Map<string, { name: string; role: string; count: number }>();
  for (const entry of logs) {
    if (!entry.actor) continue;
    const seen = observedActors.get(entry.actor.id);
    if (seen) seen.count += 1;
    else observedActors.set(entry.actor.id, { name: entry.actor.name, role: ROLE_LABELS[entry.actor.role], count: 1 });
  }

  // Records on this page a trail can be opened for, with real ids out of the log.
  const observedRecords = new Map<string, { entityType: string; entityId: string; count: number }>();
  for (const entry of logs) {
    if (!entry.entityType || !entry.entityId) continue;
    const key = `${entry.entityType}|${entry.entityId}`;
    const seen = observedRecords.get(key);
    if (seen) seen.count += 1;
    else observedRecords.set(key, { entityType: entry.entityType, entityId: entry.entityId, count: 1 });
  }

  /** Coarse verbs, derived from what is in the window — never hardcoded. */
  const coarsePrefixes = new Map<string, number>();
  for (const row of summary) {
    const head = row.action.split(".")[0];
    if (!head) continue;
    const prefix = `${head}.`;
    coarsePrefixes.set(prefix, (coarsePrefixes.get(prefix) ?? 0) + row.count);
  }

  const plainView = active.length === 0;
  const isTodayWindow = plainView || (fromKey === todayKey(timeZone) && toKey === todayKey(timeZone));

  // A page number past the last page is not an empty window, and saying it were
  // would be a lie about the log. The endpoint returns no rows and the real
  // total; this screen names the mismatch and hands back the last page.
  const pageBeyondEnd = !failure && total > 0 && logs.length === 0 && page > pages;

  const filterList = [
    action ? `action starting “${action}”` : null,
    entityType ? `kind ${ENTITY_LABELS[entityType] ?? entityType}` : null,
    entityId ? `record id ${entityId}` : null,
    actorUserId ? "one account id" : null,
    from || to ? "the date window above" : null,
  ].filter(Boolean);

  const emptyReason = active.length > 0
    ? `Nothing matches ${filterList.join(" + ")}. A combination can be empty because it is impossible, and that is shown here as a blank page rather than a zero — no count is invented to fill it in.`
    : `Nothing has been recorded on ${todayKey(timeZone)} in ${timeZone}. The log only holds what has happened since this build started writing it, so a quiet day — or the first day — is genuinely empty. “Everything recorded so far” above opens the whole trail.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
          <p className="hint mt-1">
            {total} entr{total === 1 ? "y" : "ies"} in this window ·{" "}
            <WindowLabel from={from} to={to} timeZone={timeZone} /> · the restaurant&apos;s own clock, {timeZone}.
          </p>
        </div>
        <Link href="/admin/audit" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      <Note>
        This log is read-only by design. Nothing here edits, tidies or removes an entry, and no such control exists
        anywhere in the panel: a change that has been written down stays written down, even after the record it
        describes is voided or archived. Financial records are never deleted, and the trail of them is not deletable
        either.
      </Note>

      {ignoredFrom || ignoredTo ? (
        <p className="notice notice-error">
          {[ignoredFrom ? `“${askedFrom}”` : null, ignoredTo ? `“${askedTo}”` : null]
            .filter(Boolean)
            .join(" and ")}{" "}
          is not a date we can read, so it was left out and{" "}
          {from || to ? "the rest of the window still applies" : "today is shown instead"}. Dates are written
          YYYY-MM-DD. The endpoint refuses such a window outright with a validation error; this screen says so instead
          of failing the page.
        </p>
      ) : null}

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the log is exactly as it was.{" "}
          <Link href="/admin/audit" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : null}

      {trailAsked ? (
        <Panel
          title={
            trailReady
              ? `History of ${ENTITY_LABELS[trailType as string] ?? trailType} ${trailId}`
              : "Trail not opened"
          }
          description={
            trailReady
              ? "Every entry written against this one record, oldest first. The date window above does not limit a trail — this is the record's whole recorded history, newest 100 entries at most."
              : undefined
          }
          actions={
            <Link href={hrefFor({ trailType: null, trailId: null })} className="btn btn-outline btn-sm">
              Close the trail
            </Link>
          }
        >
          {!trailReady ? (
            <Note kind="error">
              A trail needs both halves: the kind of record (three to forty characters) and its id.{" "}
              {trailTypeRaw && trailTypeRaw.length < 3 ? `“${trailTypeRaw}” is too short a type name.` : null}
            </Note>
          ) : trail.length === 0 ? (
            <EmptyState title="Nothing recorded against that record">
              The log holds no entry for {ENTITY_LABELS[trailType as string] ?? trailType} with id {trailId}. Either
              that record was changed before this build started writing the log, or the id belongs to a different kind
              of record. Nothing was invented to fill this in.
            </EmptyState>
          ) : (
            <>
              <ol className="space-y-3">
                {trail
                  .slice()
                  .reverse()
                  .map((entry) => {
                    const actor = actorLine(entry);
                    return (
                      <li key={entry.id} className="rounded-md border border-line px-3 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-mono text-sm font-semibold">{entry.action}</p>
                          <p className="hint" title={entry.createdAt.toISOString()}>
                            {formatInZone(entry.createdAt, timeZone, { second: "2-digit" })}
                          </p>
                        </div>
                        <p className="muted text-sm">
                          {actor.who} · {actor.role}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm font-semibold">What it says</summary>
                          <div className="mt-2 max-w-2xl">
                            <EntryDetail entry={entry} timeZone={timeZone} symbol={symbol} />
                          </div>
                        </details>
                      </li>
                    );
                  })}
              </ol>
              <p className="hint mt-3">
                {trail.length} entr{trail.length === 1 ? "y" : "ies"} in this trail.{" "}
                <Link
                  href={hrefFor({ entityType: trailType ?? null, entityId: trailId ?? null, page: null })}
                  className="underline"
                >
                  List them in the table instead
                </Link>
                .
              </p>
            </>
          )}
        </Panel>
      ) : null}

      <Panel title="Narrow the log" description="Every filter lives in the address, so a view can be shared or reloaded.">
        <form method="get" action="/admin/audit" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor="audit-action">
              Action starts with
            </label>
            <input
              id="audit-action"
              type="search"
              name="action"
              defaultValue={action ?? ""}
              maxLength={60}
              placeholder="menu. or payment.record"
              className="input mt-1"
            />
            <p className="hint mt-1">Matched as a prefix, so “payment.” catches every payment verb.</p>
          </div>
          <div>
            <label className="label" htmlFor="audit-entity-type">
              Kind of record
            </label>
            <select id="audit-entity-type" name="entityType" defaultValue={entityType ?? ""} className="select mt-1">
              <option value="">Any kind</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} — {value}
                </option>
              ))}
            </select>
            <p className="hint mt-1">An exact name, as stored. The kinds present in the window are offered below too.</p>
          </div>
          <div>
            <label className="label" htmlFor="audit-entity-id">
              Record id
            </label>
            <input
              id="audit-entity-id"
              name="entityId"
              defaultValue={entityId ?? ""}
              maxLength={64}
              autoComplete="off"
              className="input mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <label className="label" htmlFor="audit-actor">
              Account id of the person
            </label>
            <input
              id="audit-actor"
              name="actorUserId"
              defaultValue={actorUserId ?? ""}
              maxLength={64}
              autoComplete="off"
              className="input mt-1 font-mono text-xs"
            />
            <p className="hint mt-1">Staff accounts only — a guest or the system has no account id. Use a name below instead.</p>
          </div>
          <div>
            <label className="label" htmlFor="audit-from">
              From day
            </label>
            <input id="audit-from" type="date" name="from" defaultValue={fromKey ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="audit-to">
              To day
            </label>
            <input id="audit-to" type="date" name="to" defaultValue={toKey ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="audit-pagesize">
              Entries per page
            </label>
            <select id="audit-pagesize" name="pageSize" defaultValue={String(pageSize)} className="select mt-1">
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <p className="hint mt-1">At most 200, which is also the most the endpoint returns in one page.</p>
          </div>
          {trailType && trailId ? (
            <>
              <input type="hidden" name="trailType" value={trailType} readOnly />
              <input type="hidden" name="trailId" value={trailId} readOnly />
            </>
          ) : null}
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn btn-primary">
              Show entries
            </button>
            <Link href="/admin/audit" className="btn btn-ghost">
              Reset
            </Link>
            <Link href={hrefFor({ from: "1970-01-01", to: null, page: null })} className="btn btn-outline btn-sm">
              Everything recorded so far
            </Link>
          </div>
        </form>

        <p className="hint mt-3">
          Set one end only and the other stays open. Neither end set means the restaurant&apos;s own trading day —{" "}
          {todayKey(timeZone)} in {timeZone} — because an unfiltered read of the entire history is not something a page
          should do.
        </p>

        {active.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="label">Active filters</span>
            {active.map((filter) => (
              <Link key={filter.key} href={hrefFor({ [filter.key]: null, page: null })} className="badge">
                {filter.label}: {filter.value} — clear
              </Link>
            ))}
          </div>
        ) : null}
      </Panel>

      {summary.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Entries in this window" value={total} hint={`Page ${page} of ${pages}`} />
          <Stat label="Verbs recorded in it" value={summary.length} hint="Counted over the same window" />
          <Stat label="Most frequent" value={summary[0].action} hint={`${summary[0].count} time(s) in this window`} />
          <Stat
            label="Written by a named account"
            value={logs.filter((entry) => entry.actor).length}
            hint={`Of the ${logs.length} entr${logs.length === 1 ? "y" : "ies"} on this page`}
          />
        </div>
      ) : null}

      {from && to ? (
        <Panel
          title="What this window holds"
          description="Taken from the entries in it, so nothing is offered that cannot be found."
        >
          {summary.length === 0 ? (
            <p className="soft">
              Nothing at all was recorded in this window. That is a fact about the window, not a fault in the filter.
            </p>
          ) : (
            <>
              <p className="label">Groups of actions</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {[...coarsePrefixes.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([prefix, count]) => (
                    <Link key={prefix} href={hrefFor({ action: prefix, page: null })} className="badge">
                      {prefix}* — {count}
                    </Link>
                  ))}
              </div>
              <p className="label mt-4">Actions exactly as written</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {summary.slice(0, 30).map((row) => (
                  <Link key={row.action} href={hrefFor({ action: row.action, page: null })} className="badge">
                    {row.action} — {row.count}
                  </Link>
                ))}
              </div>
            </>
          )}

          {observedActors.size > 0 ? (
            <>
              <p className="label mt-4">People on this page</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {[...observedActors.entries()].map(([id, person]) => (
                  <Link key={id} href={hrefFor({ actorUserId: id, page: null })} className="badge">
                    {person.name} ({person.role}) — {person.count}
                  </Link>
                ))}
              </div>
              <p className="hint mt-1">
                Guest and system entries cannot be filtered this way; they have no account id. They are still named in
                the table below.
              </p>
            </>
          ) : null}

          {observedRecords.size > 0 ? (
            <>
              <p className="label mt-4">Records touched on this page — open one to read its history</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {[...observedRecords.values()]
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 20)
                  .map((touched) => {
                    const shortId = touched.entityId.length > 12 ? `${touched.entityId.slice(0, 12)}…` : touched.entityId;
                    const kindName = ENTITY_LABELS[touched.entityType] ?? touched.entityType;
                    return (
                      <li key={`${touched.entityType}|${touched.entityId}`}>
                        <Link
                          href={hrefFor({ trailType: touched.entityType, trailId: touched.entityId, page: null })}
                          className="badge"
                        >
                          {kindName} {shortId} — {touched.count} entr{touched.count === 1 ? "y" : "ies"}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
              <p className="hint mt-2">
                These ids are read straight out of the log, which is how you know a trail exists behind each one.
              </p>
            </>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title={isTodayWindow ? `Entries on ${todayKey(timeZone)}` : "Entries matching the filters"}
        description={`${total} entr${total === 1 ? "y" : "ies"} in this window with these filters; ${logs.length} on this page, newest first.`}
      >
        {failure ? null : pageBeyondEnd ? (
          <EmptyState title={`Page ${page} is past the end of this window`}>
            {total} entr{total === 1 ? "y" : "ies"} match these filters, and {pageSize} to a page makes that {pages}{" "}
            page{pages === 1 ? "" : "s"}. Asking beyond {pages} returns nothing, which is a fact about the page number
            and not about the log — the entries are still there.{" "}
            <Link href={hrefFor({ page: String(pages) })} className="underline">
              Show the last page
            </Link>{" "}
            or{" "}
            <Link href={hrefFor({ page: null })} className="underline">
              start at the newest
            </Link>
            .
          </EmptyState>
        ) : logs.length === 0 ? (
          <EmptyState title="No entries in this window">{emptyReason}</EmptyState>
        ) : (
          <AdminTable head={["When", "Who did it", "Action", "Record", "Detail"]}>
            {logs.map((entry) => (
              <tr key={entry.id} className="border-b border-line align-top">
                <td className="px-3 py-2" title={entry.createdAt.toISOString()}>
                  <span className="tabular-nums">{formatInZone(entry.createdAt, timeZone, { second: "2-digit" })}</span>
                </td>
                <ActorCell entry={entry} />
                <td className="px-3 py-2">
                  <span className="font-mono text-sm">{entry.action}</span>
                </td>
                <EntityCell entry={entry} />
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">What changed</summary>
                    <div className="mt-2 max-w-2xl">
                      <EntryDetail entry={entry} timeZone={timeZone} symbol={symbol} />
                      {entry.entityType && entry.entityId ? (
                        <Link
                          href={hrefFor({ trailType: entry.entityType, trailId: entry.entityId, page: null })}
                          className="btn btn-outline btn-sm mt-3"
                        >
                          Open the whole history of this record
                        </Link>
                      ) : null}
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </AdminTable>
        )}

        {!failure && logs.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {page > 1 ? (
              <Link href={hrefFor({ page: String(page - 1) })} className="btn btn-ghost btn-sm">
                Newer entries
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={hrefFor({ page: String(page + 1) })} className="btn btn-ghost btn-sm">
                Older entries
              </Link>
            ) : null}
            <span className="hint">
              Page {page} of {pages} · {pageSize} per page · newest first
            </span>
          </div>
        ) : null}

        <p className="hint mt-3">
          There is no export for this log. The report endpoints cover sales, orders, items, payments, bookings, tables
          and customers, and none of them is the audit trail, so no download link is offered here. Print the page if an
          accountant needs a copy.
        </p>
        <p className="hint mt-1">
          Money in an entry is stored as integer poisa, which is why both the figure and the poisa count are shown. A
          payment marked <span className="font-mono">isDemo</span> went through the simulated gateway and is not real
          money. A JSON payload is never printed as one raw string: each field is read, and a field whose name suggests
          a credential or a card is withheld whatever it holds.
        </p>
      </Panel>

      <Panel
        title="What this log does not cover"
        description="Written out because the panel's footer promises that changes are recorded with your name and the time, and an auditor is entitled to know where that promise falls short."
      >
        <ul className="space-y-2 text-sm soft">
          <li>
            Signing in is not an entry. The log records that an account changed its password, but not that somebody used
            it to arrive; a login leaves no line here.
          </li>
          <li>
            A request that was refused is not recorded either. A cashier opening this address produces no entry — for
            them, or for anybody reviewing the log afterwards.
          </li>
          <li>
            When a bill&apos;s lines are rebuilt because an order on the table changed, the order&apos;s status change
            is in the log, but the new bill total that follows from it is not written as an entry of its own.
          </li>
          <li>
            A table flipping to “booked” on its own, because a confirmed booking is within the hour, is not recorded.
          </li>
          <li>
            A guest asking the assistant to pass them to a manager, a retried email, and an image file removed from the
            disk are all outside the log.
          </li>
          <li>
            The requester&apos;s address is not shown here and was never stored: only a short one-way hash of it is
            kept, and the reads do not return even that. So this screen says who and when, never from where.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

export default function AdminAuditPage(props: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<AuditSkeleton />}>
      <AuditBody searchParams={props.searchParams} />
    </Suspense>
  );
}
