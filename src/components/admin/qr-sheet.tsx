import Link from "next/link";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatInZone } from "@/lib/time";
import { listTables } from "@/server/services/table.service";
import { ensureSettings } from "@/server/services/settings.service";
import { EmptyState, Note, Panel, Stat } from "@/components/admin/admin-ui";
import { QrBoard } from "@/components/admin/qr-board";

/**
 * The printable QR sticker sheet. Tables are read straight from the service
 * here (no self-fetch); each card's picture is then requested by the browser
 * from `/api/admin/tables/<id>/qr`, which enforces `table:manage` itself. The
 * token therefore never sits in an image URL the browser could leak, and it is
 * shown on screen to staff only — never on the printed card.
 */

type SearchParams = PageProps<"/admin/qr">["searchParams"];

function filterValue(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export async function QrSheet({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "table:manage")) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Table codes</h1>
          <p className="hint mt-1">Print the QR stickers that sit on every table.</p>
        </div>
        <Panel title="Owners and managers only" description="Ordering codes are credentials, so this screen follows the same rule as the QR routes themselves.">
          <p className="text-sm soft">
            Your role ({user.role.toLowerCase()}) may not view, print or replace table ordering codes. Ask an owner or
            manager to print the sheet.{" "}
            {roleHasPermission(user.role, "table:view") ? (
              <>
                Seating guests and taking bills stays on the{" "}
                <Link href="/admin/floor" className="underline">
                  floor board
                </Link>
                .
              </>
            ) : (
              "Your screen is the kitchen display, where orders arrive as guests send them."
            )}
          </p>
        </Panel>
      </div>
    );
  }

  const params = await searchParams;
  const sectionFilter = filterValue(params.section);
  const searchFilter = filterValue(params.search).slice(0, 40);

  const [tables, settings] = await Promise.all([listTables({ includeDisabled: true }), ensureSettings()]);
  const timeZone = settings.timezone;
  const appUrl = env.appUrl;
  const looksLocal = /localhost|127\.0\.0\.1/.test(appUrl);

  if (tables.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Table codes</h1>
          <p className="hint mt-1">Print the QR stickers that sit on every table.</p>
        </div>
        <EmptyState title="No tables have been set up yet">
          There is nothing to print until a table exists. Tables are added on the floor board — each one gets its own
          ordering code and QR as soon as it is created.{" "}
          <Link href="/admin/floor" className="underline">
            Add the first table on the floor screen
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  const sections = [...new Set(tables.map((table) => table.section).filter((value): value is string => Boolean(value)))].sort();
  const hasUnassigned = tables.some((table) => !table.section);

  const searchNeedle = searchFilter.toLowerCase();
  const rows = tables
    .filter((table) => {
      if (sectionFilter === "__unassigned") {
        if (table.section) return false;
      } else if (sectionFilter && table.section !== sectionFilter) {
        return false;
      }
      if (searchNeedle) {
        const inLabel = table.label.toLowerCase().includes(searchNeedle);
        const inSection = (table.section ?? "").toLowerCase().includes(searchNeedle);
        if (!inLabel && !inSection) return false;
      }
      return true;
    })
    .map((table) => ({
      id: table.id,
      label: table.label,
      number: table.number,
      capacity: table.capacity,
      section: table.section,
      isEnabled: table.isEnabled,
      status: table.status,
      disabledReason: table.disabledReason,
      publicToken: table.publicToken,
      qrHref: `/api/admin/tables/${table.id}/qr`,
    }));

  const rotationRows = rows.length
    ? await prisma.restaurantTable.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        select: { id: true, tokenRotatedAt: true },
      })
    : [];
  const rotatedById = new Map(rotationRows.map((row) => [row.id, row.tokenRotatedAt]));

  const boardTables = rows.map((row) => ({
    ...row,
    rotatedAtLabel: rotatedById.get(row.id) ? formatInZone(rotatedById.get(row.id) as Date, timeZone) : null,
  }));

  const enabledCount = tables.filter((table) => table.isEnabled).length;
  const filtersActive = Boolean(sectionFilter || searchFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Table codes</h1>
          <p className="hint mt-1">
            Print the QR stickers that sit on every table. Times are the restaurant&apos;s own clock ({timeZone}).
            Press reload on the browser for the freshest list — this screen does not update on its own.
          </p>
        </div>
        <form action="/admin/qr" method="get" className="flex flex-wrap items-end gap-2 print:hidden">
          <div>
            <label className="label" htmlFor="qr-section">
              Section
            </label>
            <select id="qr-section" name="section" className="select" defaultValue={sectionFilter}>
              <option value="">All sections</option>
              {sections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
              {hasUnassigned ? <option value="__unassigned">Unassigned</option> : null}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="qr-search">
              Table label or section
            </label>
            <input
              id="qr-search"
              name="search"
              type="search"
              className="input"
              maxLength={40}
              autoComplete="off"
              placeholder="e.g. YE251"
              defaultValue={searchFilter}
            />
          </div>
          <button type="submit" className="btn btn-outline btn-sm">
            Apply
          </button>
          {filtersActive ? (
            <Link href="/admin/qr" className="btn btn-ghost btn-sm">
              Clear filters
            </Link>
          ) : null}
        </form>
      </div>

      {looksLocal ? (
        <Note kind="error">
          The public site address is {appUrl}, which only this machine can open. Stickers printed now would encode a
          link no guest phone can reach — set the real site address before printing for service.
        </Note>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <Stat label="Tables" value={tables.length} hint="Including out-of-service ones, so nothing is lost from view." />
        <Stat label="Printable" value={enabledCount} hint="In-service tables carry a sticker; the rest are shown greyed and cannot be ticked." />
        <Stat label="Out of service" value={tables.length - enabledCount} hint="A phone scanning their code is told the table is closed." />
        <Stat label="Shown after filters" value={rows.length} hint={filtersActive ? "The print selection covers these rows only." : "No filters applied."} />
      </div>

      {rows.length === 0 ? (
        <Note kind="info">
          No table matches the filters you have applied
          {sectionFilter ? ` — ${sectionFilter === "__unassigned" ? "unassigned tables" : `section “${sectionFilter}”`}` : ""}
          {searchFilter ? ` — label or section containing “${searchFilter}”` : ""}.{" "}
          <Link href="/admin/qr" className="underline">
            Show every table again
          </Link>
          .
        </Note>
      ) : (
        <>
          <Panel title="What a guest gets by scanning" description="Stated exactly as the ordering page behaves — worth knowing before you hand out stickers.">
            <ul className="list-disc space-y-1 pl-5 text-sm soft">
              <li>The menu opens on the guest&apos;s own phone; their first scan quietly opens the visit for the table.</li>
              <li>
                Dishes they send go to the kitchen as orders, added to the table&apos;s bill at the restaurant&apos;s
                own prices. Several phones can join the same sticker.
              </li>
              <li>
                The guest can press “Ask for the bill”, but the bill itself is drawn up and finalised by staff — the
                sticker never settles anything on its own.
              </li>
              <li>
                Once staff have drawn up a bill that still has money outstanding, the guest may pay that whole amount
                online from the table screen; partial payments are taken at the counter. Until a bill exists there is
                no payment on the phone at all.
              </li>
              <li>
                If a camera will not scan, the guest types the table code into the “Join table” box on{" "}
                <span className="font-mono">/order</span> — the codes shown below are for staff to read out, and are
                deliberately kept off the printed sticker.
              </li>
            </ul>
          </Panel>

          <Panel title="Replacing a code, and which stickers are stale" description="Rotation is destructive; the app is honest about what it cannot know.">
            <p className="text-sm soft">
              Issuing a new code for a table (the button on each card, or the same action on the floor board) stops
              every previously printed sticker for that table working, immediately and irreversibly. The restaurant
              records the date a code was replaced, but it has never recorded when a sticker was printed — so this
              screen cannot say which tables definitely need reprinting. Each card shows its replacement date where
              one exists; when in doubt, reprint the table and remove the old sticker.
            </p>
          </Panel>

          <Panel title="Bulk sheet data" description="The sheet route returns JSON, not a PDF — the printable layout is made on this screen.">
            <p className="text-sm soft">
              <a
                href="/api/admin/tables/qr-sheet"
                className="underline break-all"
                target="_blank"
                rel="noreferrer"
              >
                Open the bulk QR sheet for all in-service tables (JSON)
              </a>{" "}
              — one entry per table with its ordering link and QR image embedded. It needs this same sign-in and
              contains live codes, so treat the file like the stickers: staff eyes only.{" "}
              {looksLocal
                ? "While the site address points at localhost, the links inside it are unusable off this machine."
                : `The links encode the current public address (${appUrl}).`}
            </p>
            <p className="hint mt-2">
              There is no route that produces a single composite PDF; “Print the ticked stickers” below is the
              printable artefact, and each card can also be downloaded as its own PNG.
            </p>
          </Panel>

          <QrBoard tables={boardTables} looksLocal={looksLocal} />
        </>
      )}
    </div>
  );
}

export function QrSheetSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="skeleton block h-24" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <span key={index} className="skeleton block h-72" />
        ))}
      </div>
    </div>
  );
}
