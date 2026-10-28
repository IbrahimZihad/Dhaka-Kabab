import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatInZone } from "@/lib/time";
import { chatHealth, chatTranscript } from "@/server/services/chatbot.service";
import { getSettings } from "@/server/services/settings.service";
import { Details, Note, Panel, Stat } from "@/components/admin/admin-ui";

export const metadata: Metadata = {
  // No title beyond the section name: the guest's words may contain their own name,
  // phone or email, and metadata is shared more widely than this screen.
  title: "Chat conversation",
};

/**
 * One guest conversation, exactly as it was stored and in the order it happened.
 * The reader is shown which answers came from the menu/settings lookup rather than
 * a model, and which cited no database record at all, because that difference is
 * the whole reason this inbox exists.
 */

const RECORD_LABELS: Record<string, string> = {
  MenuItem: "Menu item",
  RestaurantSettings: "Restaurant setting",
  Availability: "Live table availability",
  ReservationPolicy: "Booking policy",
  Reservation: "Reservation",
  Order: "Order",
  Llm: "AI model used",
};

function recordLabel(kind: string): string {
  return RECORD_LABELS[kind] ?? kind;
}

type SourceRow = { kind: string; label: string };

/** sourcesJson is an untyped column, so anything unreadable is counted, not guessed at. */
function readSources(value: unknown): { sources: SourceRow[]; unreadable: number } {
  if (value === null || value === undefined) return { sources: [], unreadable: 0 };
  if (!Array.isArray(value)) return { sources: [], unreadable: 1 };
  const sources: SourceRow[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      unreadable += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!kind && !label) {
      unreadable += 1;
      continue;
    }
    sources.push({ kind, label });
  }
  return { sources, unreadable };
}

function roleHeading(role: string): string {
  if (role === "USER") return "Guest asked";
  if (role === "ASSISTANT") return "Assistant answered";
  return `System entry (${role})`;
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-6 w-56" />
      <span className="skeleton block h-10 w-72" />
      <div className="grid gap-6 lg:grid-cols-2">
        <span className="skeleton block h-40" />
        <span className="skeleton block h-40" />
      </div>
      <span className="skeleton block h-72" />
    </div>
  );
}

async function TranscriptBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "chat:view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Chat conversation</h1>
        <Panel title="Not this role's screen" description="Reading guest conversations needs the chat permission.">
          <p className="text-sm soft">
            Nothing of this conversation is shown. Kitchen staff work from the{" "}
            <Link href="/kitchen" className="underline">
              kitchen display
            </Link>
            ; ask a manager to open the inbox if a guest raised something here.
          </p>
        </Panel>
      </div>
    );
  }

  let failure: string | null = null;
  let conversation: Awaited<ReturnType<typeof chatTranscript>> | null = null;
  let health: Awaited<ReturnType<typeof chatHealth>> | null = null;
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  let table: { id: string; label: string; number: number; status: string; isEnabled: boolean; section: string | null } | null =
    null;

  try {
    conversation = await chatTranscript(token);
    [health, settings] = await Promise.all([chatHealth(), getSettings()]);
    if (conversation.tableToken) {
      // The label comes from the table's own record; the raw token stays out of the page.
      table = await prisma.restaurantTable.findUnique({
        where: { publicToken: conversation.tableToken },
        select: { id: true, label: true, number: true, status: true, isEnabled: true, section: true },
      });
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      failure = "There is no conversation with this address. It may have been mistyped, or the record no longer exists.";
    } else {
      failure = error instanceof AppError ? error.message : "This conversation could not be read.";
    }
  }

  if (failure || !conversation || !settings) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Chat conversation</h1>
        <Note kind="error">
          {failure ?? "This conversation could not be read."} Nothing was changed.{" "}
          <Link href="/admin/chat" className="underline">
            Back to the inbox
          </Link>
          .
        </Note>
      </div>
    );
  }

  const timeZone = settings.timezone;
  const messages = conversation.messages;
  const answers = messages.filter((message) => message.role === "ASSISTANT");
  const fallbackAnswers = answers.filter((message) => message.usedFallback);
  const ungroundedAnswers = answers.filter((message) => readSources(message.sourcesJson).sources.length === 0);

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Opened", value: formatInZone(conversation.startedAt, timeZone) },
    { label: "Last activity", value: formatInZone(conversation.lastActiveAt, timeZone) },
    {
      label: "Asked for a person",
      value: conversation.escalatedAt ? formatInZone(conversation.escalatedAt, timeZone) : "Not asked",
    },
    {
      label: "Reason given",
      value: conversation.escalationReason ?? (conversation.escalatedAt ? "No reason given" : "Nothing to hand over"),
    },
    {
      label: "Where it came from",
      value: table ? (
        <>
          Table {table.label} (number {table.number}
          {table.section ? `, section ${table.section}` : ""}) · currently {table.isEnabled ? table.status.toLowerCase() : "out of service"}
        </>
      ) : conversation.tableToken ? (
        "A table code that no longer matches any table — the code was probably reprinted"
      ) : (
        "Not tied to a table; the guest asked from the general site"
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/admin/chat" className="hover:text-brand">
          Chat inbox
        </Link>
        <span className="mx-2">/</span>
        <span>
          Opened {formatInZone(conversation.startedAt, timeZone)}
          {table ? ` · table ${table.label}` : ""}
        </span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Guest conversation</h1>
          <p className="hint mt-1">
            {messages.length} message{messages.length === 1 ? "" : "s"} · {answers.length} answer
            {answers.length === 1 ? "" : "s"} · shown exactly as stored, oldest first, in {timeZone}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {conversation.escalatedAt ? <span className="badge badge-closed">Asked for a person</span> : null}
          {conversation.fallbackOnly ? <span className="badge">No model on the last answer</span> : null}
        </div>
      </div>

      {health && !health.aiConfigured ? (
        <Note kind="error">
          No AI model is configured on this installation, so every answer below was produced by the lookup over our menu
          and settings rows; none of it was written by a model. {health.aiReason}
        </Note>
      ) : null}
      {health && !health.enabled ? (
        <Note kind="info">
          The assistant is switched off in settings now, so this conversation predates that. No new guest questions are
          being taken.
        </Note>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Answers" value={answers.length} hint="What the guest was told" />
        <Stat
          label="From the records, not a model"
          value={fallbackAnswers.length}
          hint={
            health && !health.aiConfigured
              ? "All of them, because no model is configured"
              : "Marked per message below"
          }
        />
        <Stat
          label="Citing no database record"
          value={ungroundedAnswers.length}
          hint="These answers are not traceable to a row we read"
        />
      </div>

      <Panel title="The conversation" description="Guest question, then the assistant's own words.">
        {messages.length === 0 ? (
          <Note kind="info">
            This conversation exists but no message was ever stored on it — the guest opened the widget and said nothing.
          </Note>
        ) : (
          <ol className="space-y-4">
            {messages.map((message, index) => {
              const { sources, unreadable } = readSources(message.sourcesJson);
              const kinds = [...new Set(sources.map((source) => source.kind))];
              return (
                <li key={`${message.id}-${index}`} className="rounded-lg border border-line px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="label">{roleHeading(message.role)}</p>
                    <span className="hint">{formatInZone(message.createdAt, timeZone)}</span>
                  </div>

                  {message.role === "ASSISTANT" && message.usedFallback ? (
                    <p className="mt-1 flex flex-wrap gap-2">
                      <span className="badge">Written from our records, not a model</span>
                    </p>
                  ) : null}

                  <p className="mt-2 whitespace-pre-line text-sm soft">{message.content}</p>

                  {message.role === "ASSISTANT" ? (
                    sources.length === 0 ? (
                      <p className="hint mt-2">
                        <span className="badge badge-closed">Not grounded in a database record</span> Nothing was
                        recorded as the source of this answer, so treat the details as needing a check before repeating
                        them to the guest.
                      </p>
                    ) : (
                      <div className="mt-2 rounded-md bg-paper px-3 py-2">
                        <p className="label">Grounded in</p>
                        <ul className="mt-1 space-y-1 text-sm soft">
                          {sources.map((source, sourceIndex) => (
                            <li key={`${source.kind}-${source.label}-${sourceIndex}`}>
                              <span className="font-semibold">{recordLabel(source.kind || "Record")}</span>
                              {source.label ? `: ${source.label}` : " (no identifier recorded)"}
                            </li>
                          ))}
                        </ul>
                        {kinds.length === 1 && kinds[0] === "Llm" ? (
                          <p className="hint mt-1">
                            Only the model is cited — no menu or settings row was recorded as the source.
                          </p>
                        ) : null}
                        {unreadable > 0 ? (
                          <p className="hint mt-1">
                            {unreadable} source entr{unreadable === 1 ? "y" : "ies"} on this message could not be read, so
                            {unreadable === 1 ? " it is" : " they are"} not listed.
                          </p>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        <p className="hint mt-4">
          Any price quoted inside an answer is the assistant&apos;s own display text. Read the live figure from the menu
          section, not from this transcript.
        </p>
        <p className="hint mt-1">
          Transcripts can contain names, phone numbers and emails the guest typed. Keep them inside the panel — there is
          no link here to share this guest&apos;s session with anyone.
        </p>
      </Panel>

      <Panel title="The thread" description="Who is involved and where to pick it up.">
        <Details rows={rows} />
        <div className="mt-4 flex flex-wrap gap-2">
          {table ? (
            <>
              <Link href={`/admin/orders?tableId=${encodeURIComponent(table.id)}`} className="btn btn-outline btn-sm">
                Orders from table {table.label}
              </Link>
              <Link href={`/admin/floor?search=${encodeURIComponent(table.label)}`} className="btn btn-ghost btn-sm">
                Table {table.label} on the floor board
              </Link>
            </>
          ) : null}
          <Link href="/admin/chat" className="btn btn-ghost btn-sm">
            Back to the inbox
          </Link>
        </div>
      </Panel>

      <Panel
        title="Handing it to a person"
        description="What the guest sees when they press “speak to a person”, and what happens next."
      >
        {conversation.escalatedAt ? (
          <p className="text-sm soft">
            Asked on {formatInZone(conversation.escalatedAt, timeZone)}
            {conversation.escalationReason ? ` · reason: “${conversation.escalationReason}”` : " · no reason given"}. A
            staff notification was queued with it. This screen cannot mark the request closed and cannot reply from
            here — there is no such field or endpoint on the conversation record, so nothing here pretends otherwise.
            Handle it with the guest directly.
          </p>
        ) : (
          <p className="text-sm soft">
            The guest never asked for a person in this thread. If the answers above were not good enough, that is on the
            assistant, not the guest.
          </p>
        )}
      </Panel>
    </div>
  );
}

export default function AdminChatTranscriptPage(props: PageProps<"/admin/chat/[token]">) {
  return (
    <Suspense fallback={<TranscriptSkeleton />}>
      <TranscriptBody params={props.params} />
    </Suspense>
  );
}
