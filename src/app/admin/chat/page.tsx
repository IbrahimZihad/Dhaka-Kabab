import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dayRange, formatInZone, todayKey, zonedParts } from "@/lib/time";
import { chatHealth, listConversations } from "@/server/services/chatbot.service";
import { getSettings } from "@/server/services/settings.service";
import { EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";

export const metadata: Metadata = {
  title: "Chat inbox",
  // Deliberately nothing else: transcripts carry whatever a guest typed, including
  // their own name and phone number, and that must not reach page metadata.
};

/**
 * The assistant inbox. The point of this screen is that a manager can tell three
 * things apart at a glance: an answer a model wrote, an answer the system produced
 * from our own menu and settings rows, and a guest who gave up and asked for a
 * person. Nothing here pretends the assistant is cleverer than it is, and there is
 * no "resolve" button — the conversation record has no such field, so a button
 * would only be a lie.
 */

/** Every filter lives in the address, so a view can be shared or reloaded. */
const FILTER_KEYS = ["escalated", "dateKey", "page", "pageSize"] as const;

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
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

/** Mirrors the endpoint: only these two spellings mean "escalated only". */
function escalatedFlag(value: string | undefined): "on" | "off" | "unreadable" {
  if (value === undefined) return "off";
  return value === "1" || value === "true" ? "on" : "unreadable";
}

function preview(content: string): string {
  const firstLine = content.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  if (firstLine.length === 0) return "(empty message)";
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "The conversations could not be read.";
}

function ChatInboxSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-44" />
      <span className="skeleton block h-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <span className="skeleton block h-72" />
    </div>
  );
}

async function ChatInboxBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "chat:view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Chat inbox</h1>
        <Panel title="Not this role's screen" description="Reading guest conversations needs the chat permission.">
          <p className="text-sm soft">
            Kitchen staff are not given guests&apos; conversations — your screen is the{" "}
            <Link href="/kitchen" className="underline">
              kitchen display
            </Link>
            . If a guest tells you something the assistant mishandled, say so at the counter and a manager can open it
            here.
          </p>
        </Panel>
      </div>
    );
  }

  const raw = await searchParams;
  const escalated = escalatedFlag(single(raw, "escalated"));
  const ignoredEscalated = escalated === "unreadable";
  const askedDateKey = single(raw, "dateKey");
  const dateKeyFilter = validDateKey(askedDateKey);
  const ignoredDateKey = askedDateKey !== undefined && dateKeyFilter === undefined;
  const { page, pageSize, skip, take } = paginateChats({
    page: positiveInt(single(raw, "page")),
    pageSize: positiveInt(single(raw, "pageSize")),
  });

  const settings = await getSettings();
  const timeZone = settings.timezone;
  const today = todayKey(timeZone);
  const yesterday = zonedParts(new Date(dayRange(today, timeZone).start.getTime() - 60_000), timeZone).dateKey;

  // Same contract as /api/admin/chat/conversations: one day on the restaurant's own
  // clock, or every day when no day is chosen.
  const window = dateKeyFilter ? dayRange(dateKeyFilter, timeZone) : null;

  const current: Record<string, string | undefined> = {
    escalated: escalated === "on" ? "1" : undefined,
    dateKey: dateKeyFilter,
    page: page > 1 ? String(page) : undefined,
    pageSize: pageSize !== 30 ? String(pageSize) : undefined,
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
    return query ? `/admin/chat?${query}` : "/admin/chat";
  }

  let failure: string | null = null;
  let rows: Awaited<ReturnType<typeof listConversations>>["conversations"] = [];
  let total = 0;
  let escalatedTotal = 0;
  let health: Awaited<ReturnType<typeof chatHealth>> | null = null;
  const tableLabels = new Map<string, { id: string; label: string; status: string; isEnabled: boolean }>();

  try {
    const [listed, check] = await Promise.all([
      listConversations(
        { escalated: escalated === "on" ? true : undefined, from: window?.start, to: window?.end },
        { skip, take },
      ),
      chatHealth(),
    ]);
    rows = listed.conversations;
    total = listed.total;
    escalatedTotal = listed.escalated;
    health = check;

    // Show a table's label, never the raw token it arrived with.
    const tokens = [...new Set(rows.map((row) => row.tableToken).filter((token): token is string => Boolean(token)))];
    if (tokens.length > 0) {
      const tables = await prisma.restaurantTable.findMany({
        where: { publicToken: { in: tokens } },
        select: { publicToken: true, id: true, label: true, status: true, isEnabled: true },
      });
      for (const table of tables) tableLabels.set(table.publicToken, table);
    }
  } catch (error) {
    failure = describeFailure(error);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat inbox</h1>
          <p className="hint mt-1">
            What guests asked the assistant, what it actually answered, and who asked for a person. Times are the
            restaurant&apos;s own ({timeZone}). Money quoted inside an answer is the assistant&apos;s own text — it is
            never recalculated here.
          </p>
        </div>
        <Link href="/admin/chat" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the conversations are where they were.{" "}
          <Link href="/admin/chat" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : (
        <>
          <Panel
            title="Can this assistant answer at all?"
            description="Counts below cover the last 24 hours; the list follows the filters you set."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Conversations" value={health?.conversationsLast24h ?? 0} hint="Active in the last 24 hours" />
              <Stat label="Messages" value={health?.messagesLast24h ?? 0} hint="Questions and answers together" />
              <Stat label="Asked for a person" value={health?.escalationsLast24h ?? 0} hint="In the last 24 hours" />
              <Stat label="Escalated, all time" value={escalatedTotal} hint="No way to mark one closed; see below" />
            </div>

            <div className="mt-4 space-y-2">
              {health && !health.enabled ? (
                <Note kind="error">
                  The assistant is switched off in settings, so no guest can ask it anything right now. Anything below
                  is history.
                </Note>
              ) : null}
              {health && !health.aiConfigured ? (
                <Note kind="error">
                  No AI model is configured on this installation, so nothing in this inbox was written by a model —
                  every answer came from the lookup over our menu and settings rows.{" "}
                  {health.aiReason}
                </Note>
              ) : null}
              {health?.aiConfigured && health?.fallbackOnly ? (
                <Note kind="info">
                  A model is configured ({health.aiModel ?? "name not reported"}), but the assistant is set to
                  fallback-only mode, so it answers from our records and does not ask the model.
                </Note>
              ) : null}
              {health?.aiConfigured && !health?.fallbackOnly && health?.enabled ? (
                <Note kind="ok">
                  A model is configured ({health.aiModel ?? "name not reported"}) and is in use. Answers that still fell
                  back to the records lookup are marked individually.
                </Note>
              ) : null}
              <p className="hint">
                The &ldquo;no model on the last answer&rdquo; mark follows the conversation&apos;s newest answer only —
                the record stores a single flag, so an older answer in the same thread may differ. Open a conversation to
                see the mark on every message.
              </p>
            </div>
          </Panel>

          <Panel title="Find conversations" description="Filters live in the address, so a view can be shared or reloaded.">
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                href={hrefFor({ escalated: escalated === "on" ? null : "1", page: null })}
                className={escalated === "on" ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              >
                {escalated === "on" ? "Showing escalations only — show all" : "Escalated to a person only"}
              </Link>
              <Link
                href={hrefFor({ dateKey: today, page: null })}
                className={dateKeyFilter === today ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              >
                Today
              </Link>
              <Link
                href={hrefFor({ dateKey: yesterday, page: null })}
                className={dateKeyFilter === yesterday ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              >
                Yesterday
              </Link>
              <Link
                href={hrefFor({ dateKey: null, page: null })}
                className={!dateKeyFilter ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              >
                Every day
              </Link>
            </div>

            <form method="get" action="/admin/chat" className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="chat-date">
                  Day (YYYY-MM-DD, restaurant time)
                </label>
                <input id="chat-date" type="date" name="dateKey" defaultValue={dateKeyFilter ?? ""} className="input" />
              </div>
              {escalated === "on" ? <input type="hidden" name="escalated" value="1" readOnly /> : null}
              <button type="submit" className="btn btn-outline btn-sm">
                Show that day
              </button>
            </form>

            {ignoredDateKey ? (
              <p className="notice notice-error mt-4">
                &ldquo;{askedDateKey}&rdquo; is not a day we can read, so every day is shown instead. Dates are written
                YYYY-MM-DD.
              </p>
            ) : null}
            {ignoredEscalated ? (
              <p className="notice notice-error mt-4">
                The escalated filter only understands 1 or true; the value given was not read, so all conversations are
                shown.
              </p>
            ) : null}
          </Panel>

          <Panel
            title={
              dateKeyFilter
                ? `Conversations active on ${dateKeyFilter}`
                : escalated === "on"
                  ? "Every escalated conversation"
                  : "All conversations"
            }
            description={`${total} conversation${total === 1 ? "" : "s"} match${total === 1 ? "es" : ""} this window; ${rows.length} on this page, newest activity first.`}
          >
            {rows.length === 0 ? (
              <EmptyState
                title={
                  total === 0
                    ? dateKeyFilter
                      ? `Nothing was asked on ${dateKeyFilter}`
                      : escalated === "on"
                        ? "No guest has asked for a person yet"
                        : "The inbox is empty"
                    : "No conversations on this page"
                }
              >
                {total === 0 ? (
                  <>
                    {dateKeyFilter
                      ? `No conversation was still active on ${dateKeyFilter} (${timeZone}). `
                      : "No chat conversation exists at all yet. "}
                    <Link href="/admin/chat" className="underline">
                      Show every day
                    </Link>
                    , or ask the assistant something from the site yourself to see how an answer is recorded.
                  </>
                ) : (
                  <>Page {page} is past the end of this window — go back a page.</>
                )}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((row) => {
                  const table = row.tableToken ? tableLabels.get(row.tableToken) : undefined;
                  const lastRole = row.lastMessage?.role;
                  return (
                    <li key={row.id} className="card-hover flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.escalatedAt ? <span className="badge badge-closed">Asked for a person</span> : null}
                          {row.fallbackOnly ? <span className="badge">No model on the last answer</span> : null}
                          <span className="label">
                            {row.messageCount} message{row.messageCount === 1 ? "" : "s"}
                          </span>
                          {row.tableToken ? (
                            <span className="badge badge-brand">
                              {table ? `Table ${table.label}` : "Table code no longer matches"}
                            </span>
                          ) : (
                            <span className="badge">Not from a table</span>
                          )}
                        </div>
                        <p className="mt-1 text-sm soft">
                          {lastRole === "ASSISTANT" ? "Assistant: " : lastRole === "USER" ? "Guest: " : lastRole ? `${lastRole}: ` : "Nothing recorded: "}
                          {row.lastMessage ? preview(row.lastMessage.content) : "(no message stored)"}
                        </p>
                        <p className="hint mt-1">
                          Opened {formatInZone(row.startedAt, timeZone)} · last message{" "}
                          {formatInZone(row.lastActiveAt, timeZone)}
                          {row.escalationReason ? ` · reason given: “${preview(row.escalationReason)}”` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Link href={`/admin/chat/${encodeURIComponent(row.publicToken)}`} className="btn btn-ghost btn-sm">
                          Read it
                        </Link>
                        {table ? (
                          <span className="hint text-right">
                            <Link href={`/admin/orders?tableId=${encodeURIComponent(table.id)}`} className="underline">
                              Orders from this table
                            </Link>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {total > 0 ? (
              <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pages">
                <span className="muted">
                  Page {page} of {pages} · newest activity first
                </span>
                <span className="flex gap-2">
                  {page > 1 ? (
                    <Link href={hrefFor({ page: String(page - 1) })} className="btn btn-outline btn-sm">
                      Newer
                    </Link>
                  ) : null}
                  {page < pages ? (
                    <Link href={hrefFor({ page: String(page + 1) })} className="btn btn-outline btn-sm">
                      Earlier
                    </Link>
                  ) : null}
                </span>
              </nav>
            ) : null}
          </Panel>

          <Panel title="What this screen cannot do" description="Stated plainly so nobody waits for a button that does not exist.">
            <p className="text-sm soft">
              A conversation has no &ldquo;resolved&rdquo;, &ldquo;replied&rdquo; or &ldquo;assigned to&rdquo; field in
              the database, and there is no endpoint that answers a guest from here, so this screen offers none — the
              escalated count keeps growing even after the team handled it in person, and that is a schema gap rather
              than something to fake with a button. To reply, go to the guest: at the table, by phone, or the guest
              opens the chat again themselves.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

/** The endpoint's own caps: 30 per page, at most 200. */
function paginateChats(input: { page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 30));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export default function AdminChatPage(props: PageProps<"/admin/chat">) {
  return (
    <Suspense fallback={<ChatInboxSkeleton />}>
      <ChatInboxBody searchParams={props.searchParams} />
    </Suspense>
  );
}
