import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import type { UserRole } from "@prisma/client";
import { paginate } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { ROLE_LABELS, roleHasPermission } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";
import { formatInZone } from "@/lib/time";
import { getSettings } from "@/server/services/settings.service";
import { listStaff } from "@/server/services/staff.service";
import { AdminTable, EmptyState, Note, Panel } from "@/components/admin/admin-ui";
import {
  STAFF_ROLE_VALUES,
  capabilitiesFor,
  permissionCount,
  totalPermissionCount,
} from "@/components/admin/staff-capability-map";
import { StaffAccountCreate } from "@/components/admin/staff-account-create";
import { StaffAccessControls } from "@/components/admin/staff-access-controls";
import { StaffPasswordResetForm } from "@/components/admin/staff-password-reset-form";

export const metadata: Metadata = { title: "Staff" };

/**
 * Staff accounts and roles — the only section of the panel an owner alone may
 * open, because it is where a person is given or taken away the rights every
 * other section is built on.
 *
 * The read is the same `listStaff` the staff endpoint wraps, and the capability
 * lists are the same `ROLE_PERMISSIONS` object that endpoint returns, so the
 * screen and the API cannot disagree about what a role does. Filters live in the
 * address bar, exactly as the orders screen does.
 *
 * No password, hash or token is ever rendered here. A minted password arrives in
 * the response of the create request, inside one client component, and this page
 * never puts one in a link, in metadata or in a value the server reads back.
 */

const FILTER_KEYS = ["role", "active", "search", "page", "pageSize"] as const;

type Params = Record<string, string | string[] | undefined>;

function single(raw: Params, key: string): string | undefined {
  const value = raw[key];
  const text = typeof value === "string" ? value.trim() : undefined;
  return text && text.length > 0 ? text : undefined;
}

function roleFilter(value: string | undefined): UserRole | undefined {
  return STAFF_ROLE_VALUES.includes(value as UserRole) ? (value as UserRole) : undefined;
}

/** The staff endpoint's own spelling: 1/true means active, 0/false means stopped. */
function activeFilter(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (["1", "true"].includes(value)) return true;
  if (["0", "false"].includes(value)) return false;
  return undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "The staff accounts could not be read.";
}

function StateBadge({ active }: { active: boolean }) {
  return <span className={active ? "badge badge-open" : "badge badge-closed"}>{active ? "Active" : "Stopped"}</span>;
}

function StaffSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <span className="skeleton block h-9 w-44" />
        <span className="skeleton block h-4 w-full max-w-2xl" />
      </div>
      <span className="skeleton block h-48" />
      <span className="skeleton block h-32" />
      <span className="skeleton block h-96" />
    </div>
  );
}

async function StaffBody({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "staff:manage")) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff</h1>
          <p className="hint mt-1">Accounts, roles and passwords for the people who work here.</p>
        </div>
        <Panel title="Your role may not view or change staff accounts" description="Nothing on this screen is editable from your account, so there is nothing to fill in.">
          <p className="text-sm soft">
            Staff accounts are held to one permission, <code>staff:manage</code>, and in this restaurant only the{" "}
            {ROLE_LABELS.OWNER} role carries it — {ROLE_LABELS.MANAGER.toLowerCase()}, {ROLE_LABELS.CASHIER.toLowerCase()}{" "}
            and {ROLE_LABELS.KITCHEN.toLowerCase()} do not. That is decided by the same table the endpoints check, not by
            hiding a button: the account list, the create form, role changes, password resets and stops are all refused
            for your role, and no form is shown here because every one of them would be refused the moment it was sent.
          </p>
          <p className="hint mt-3">
            If a colleague has left or an account needs a new password, the {ROLE_LABELS.OWNER} does it from this
            screen. Everything you have done is already attributed to your account in the audit log, which a manager may
            read.
          </p>
        </Panel>
      </div>
    );
  }

  const raw = await searchParams;
  const role = roleFilter(single(raw, "role"));
  const activeRaw = single(raw, "active");
  const isActive = activeFilter(activeRaw);
  const ignoredActive = activeRaw !== undefined && isActive === undefined;
  const search = single(raw, "search")?.slice(0, 60);
  const { page, pageSize, skip, take } = paginate({
    page: positiveInt(single(raw, "page")),
    pageSize: positiveInt(single(raw, "pageSize")),
  });

  let loadFailure: string | null = null;
  // The settings row's own default, used only if the read below fails, in which
  // case there are no dates left to print with it.
  let timeZone = "Asia/Dhaka";
  let rows: Awaited<ReturnType<typeof listStaff>>["staff"] = [];
  let total = 0;

  try {
    const [settings, listed] = await Promise.all([
      getSettings(),
      listStaff({ role, isActive, search }, { skip, take }),
    ]);
    timeZone = settings.timezone;
    rows = listed.staff;
    total = listed.total;
  } catch (error) {
    loadFailure = describeFailure(error);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const when = (value: Date | null) => (value ? formatInZone(value, timeZone) : null);

  const current: Record<string, string | undefined> = {
    role,
    active: isActive === undefined ? undefined : isActive ? "1" : "0",
    search,
    page: page > 1 ? String(page) : undefined,
    pageSize: pageSize !== paginate({}).pageSize ? String(pageSize) : undefined,
  };

  function hrefFor(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const override = overrides[key];
      const value = override === undefined ? current[key] : override;
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/admin/staff?${query}` : "/admin/staff";
  }

  const active: { key: string; label: string; value: string }[] = [];
  if (role) active.push({ key: "role", label: "Role", value: ROLE_LABELS[role] });
  if (isActive !== undefined) active.push({ key: "active", label: "State", value: isActive ? "Active" : "Stopped" });
  if (search) active.push({ key: "search", label: "Search", value: search });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff</h1>
          <p className="hint mt-1">
            {loadFailure
              ? "The account list could not be read, so no counts are given."
              : `${total} staff account${total === 1 ? "" : "s"} match what is asked for below; ${rows.length} on this page.`}{" "}
            Signed in as {ROLE_LABELS[user.role]} — this section is open to that role alone, and the endpoints behind it
            check the same thing twice.
          </p>
        </div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          Clear all filters
        </Link>
      </div>

      <Note kind="error">
        Everything here is permanent in one way: a name, a role and an account id are written into the audit log, the
        bills and the payments the moment they happen. Stopping an account does not remove any of that, and the panel
        offers no way to delete a staff account at all.
      </Note>

      <Panel
        title="Create an account"
        description="The password is generated for you and shown once, in the answer to this one request."
      >
        <StaffAccountCreate />
      </Panel>

      <Panel title="Find accounts" description="Filters live in the address, so a view can be shared or reloaded.">
        <form method="get" action="/admin/staff" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="staff-search">
              Name or email
            </label>
            <input
              id="staff-search"
              type="search"
              name="search"
              defaultValue={search ?? ""}
              maxLength={60}
              placeholder="Part of a name or address"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="label" htmlFor="staff-role">
              Role
            </label>
            <select id="staff-role" name="role" defaultValue={role ?? ""} className="select mt-1">
              <option value="">Every staff role</option>
              {STAFF_ROLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="staff-active">
              State
            </label>
            <select id="staff-active" name="active" defaultValue={current.active ?? ""} className="select mt-1">
              <option value="">Active and stopped</option>
              <option value="1">Active only</option>
              <option value="0">Stopped only</option>
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn btn-outline btn-sm">
              Show accounts
            </button>
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
          <p className="hint mt-4">
            No filters applied, so every staff account shows — ordered by role, then name. Customer accounts are not
            listed here; they belong under Customers, and the staff list leaves them out unless one is opened by name.
          </p>
        )}

        {ignoredActive ? (
          <p className="notice notice-error mt-4">
            &ldquo;{activeRaw}&rdquo; is not a state the endpoint reads, so both are shown. Use active only or stopped
            only in the box above.
          </p>
        ) : null}
      </Panel>

      <Panel
        title={active.length > 0 ? "Accounts matching" : "All staff accounts"}
        description="Last sign-in is the one thing here that only the account itself can produce: it is stamped when the password is verified."
      >
        {loadFailure ? (
          <Note kind="error">
            {loadFailure} Nothing was changed by this request — no account was created, renamed, re-rostered or stopped.
          </Note>
        ) : rows.length === 0 ? (
          <EmptyState title="No account matches">
            Nobody has that name or address in the staff list, or the filters have narrowed it to nothing. Clear a
            filter above and try again.
          </EmptyState>
        ) : (
          <>
            <AdminTable head={["Account", "Role", "State", "Last sign-in", "Added", "Their record", "Controls"]}>
              {rows.map((row) => {
                const isSelf = row.id === user.id;
                return (
                  <tr key={row.id} className="border-b border-line align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold">
                        {row.name}
                        {isSelf ? <span className="badge badge-brand ml-2">You</span> : null}
                      </p>
                      <p className="muted">{row.email}</p>
                      {row.phone ? <p className="hint">{row.phone}</p> : null}
                    </td>
                    <td className="px-3 py-2">{ROLE_LABELS[row.role]}</td>
                    <td className="px-3 py-2">
                      <StateBadge active={row.isActive} />
                    </td>
                    <td className="px-3 py-2 muted">{when(row.lastLoginAt) ?? "Never signed in"}</td>
                    <td className="px-3 py-2 muted">{when(row.createdAt) ?? "—"}</td>
                    <td className="px-3 py-2 muted">
                      {row._count.ordersCreated} order{row._count.ordersCreated === 1 ? "" : "s"} placed under this
                      account as a guest · {row._count.paymentsTaken} payment{row._count.paymentsTaken === 1 ? "" : "s"}{" "}
                      recorded · {row._count.auditLogs} audit entr{row._count.auditLogs === 1 ? "y" : "ies"} naming them
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-2">
                        <Link href={`/admin/staff/${row.id}`} className="btn btn-ghost btn-sm">
                          Open
                        </Link>
                        <StaffAccessControls
                          account={{ id: row.id, name: row.name, email: row.email, role: row.role, isActive: row.isActive }}
                          isSelf={isSelf}
                          compact
                        />
                        <StaffPasswordResetForm accountId={row.id} displayName={row.name} isSelf={isSelf} compact />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </AdminTable>

            <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="muted">
                Page {page} of {pages} · {pageSize} to a page, ordered by role then name
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
            <p className="hint mt-3">
              These are counts, not amounts: the staff list carries no money figures. What a person took at the counter
              is on the bills and payments screens, where the figures themselves live.
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="What each role is allowed"
        description={`These lists are the permission table itself, not a summary of it: ${totalPermissionCount()} abilities in all, and the very object the staff endpoint returns as its permissions field.`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {STAFF_ROLE_VALUES.map((roleValue) => {
            const sections = capabilitiesFor(roleValue);
            return (
              <div key={roleValue} className="rounded-md border border-line p-4">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{ROLE_LABELS[roleValue]}</span>
                  <span className="hint">
                    {permissionCount(roleValue)} of {totalPermissionCount()} abilities
                  </span>
                </p>
                {sections.length === 0 ? (
                  <p className="hint mt-2">Carries no panel permissions at all.</p>
                ) : (
                  <dl className="mt-2 space-y-2 text-sm">
                    {sections.map((section) => (
                      <div key={section.group}>
                        <dt className="label">{section.label}</dt>
                        <dd className="soft">{section.items.map((item) => item.label).join("; ")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {roleValue === "OWNER" ? (
                  <p className="hint mt-2">
                    The owner role is the only one that may open this screen, change a password or stop an account.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="hint mt-3">
          A fifth role, {ROLE_LABELS.CUSTOMER}, exists in the same table for guests who sign in. It holds no panel
          permissions, is never offered as a staff role here, and the accounts themselves are edited under Customers.
        </p>
      </Panel>

      <Panel title="What this screen cannot do" description="None of the refusals below are a missing feature to work around.">
        <ul className="space-y-2 text-sm soft">
          <li>
            No password is ever shown twice. The minted one appears once, in the answer to the request that created it;
            a reset password is typed by you and then gone. The database keeps only a hash, so nothing here can read a
            password back — if one is lost, set another.
          </li>
          <li>
            No forced change on first sign-in. Nothing in the schema marks an account as needing a new password, and
            signing in checks the password and whether the account is active, so a minted password keeps working until
            somebody replaces it. Hand it over in person, to a named member of staff.
          </li>
          <li>
            No deletion. The stop control is the same action the API&apos;s delete route performs — it deactivates —
            because that account is named by orders, payments and audit entries that must stay attributable.
          </li>
          <li>
            The last active owner cannot be demoted or stopped. The service counts the other active owners first and
            refuses if there are none, so the restaurant always has somebody who can change settings. Its refusal is
            shown in its own words.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

export default function AdminStaffPage(props: PageProps<"/admin/staff">) {
  return (
    <Suspense fallback={<StaffSkeleton />}>
      <StaffBody searchParams={props.searchParams} />
    </Suspense>
  );
}
