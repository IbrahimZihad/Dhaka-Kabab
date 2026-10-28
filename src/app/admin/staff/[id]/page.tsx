import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS, roleHasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { formatInZone } from "@/lib/time";
import { getStaffById, staffActivity } from "@/server/services/staff.service";
import { getSettings } from "@/server/services/settings.service";
import { Details, EmptyState, Note, Panel } from "@/components/admin/admin-ui";
import { capabilitiesFor } from "@/components/admin/staff-capability-map";
import { StaffAccessControls } from "@/components/admin/staff-access-controls";
import { StaffAccountForm } from "@/components/admin/staff-account-form";
import { StaffPasswordResetForm } from "@/components/admin/staff-password-reset-form";

export const metadata: Metadata = { title: "Staff account" };

/**
 * One staff account: what it is, what it may do, how it is signed in, and the
 * record it has left behind.
 *
 * Everything on this page comes from the two reads the staff detail endpoint
 * wraps — `getStaffById` and, for the activity list, `staffActivity`, which is
 * the same audit query the service already exposes — so nothing is described here
 * that the API would not also return. As on the list screen, no password, hash or
 * token is rendered anywhere: the session records below are counted and dated, and
 * their ids are deliberately not printed.
 */

/** Actions this screen itself writes, in the words the service stores them under. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "staff.create": "Account created",
  "staff.update": "Account details changed",
  "auth.password.admin_reset": "Password set by an owner",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

function StateBadge({ active }: { active: boolean }) {
  return <span className={active ? "badge badge-open" : "badge badge-closed"}>{active ? "Active" : "Stopped"}</span>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-8 w-56" />
      <span className="skeleton block h-32" />
      <span className="skeleton block h-48" />
      <span className="skeleton block h-48" />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/staff" className="btn btn-ghost btn-sm self-start">
      Back to staff accounts
    </Link>
  );
}

async function StaffAccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;

  if (!roleHasPermission(user.role, "staff:manage")) {
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="text-3xl font-bold tracking-tight">Staff account</h1>
        <Panel
          title="Your role may not view or change staff accounts"
          description="This account's details, role and password are all closed to you."
        >
          <p className="text-sm soft">
            Reading a staff account, changing its role, setting its password and stopping it all sit behind one
            permission, <code>staff:manage</code>, and only the {ROLE_LABELS.OWNER} role holds it. Nothing on this page
            would be saved from yours, so no form is offered — ask the {ROLE_LABELS.OWNER.toLowerCase()} to make the
            change here.
          </p>
        </Panel>
      </div>
    );
  }

  const now = new Date();
  let loadFailure: string | null = null;
  let account: Awaited<ReturnType<typeof getStaffById>> | null = null;
  let activity: Awaited<ReturnType<typeof staffActivity>> = [];
  let timeZone = "Asia/Dhaka";

  try {
    const [settings, loaded, trail] = await Promise.all([getSettings(), getStaffById(id), staffActivity(id)]);
    timeZone = settings.timezone;
    account = loaded;
    activity = trail;
  } catch (error) {
    loadFailure = error instanceof AppError ? error.message : "This staff account could not be read.";
  }

  if (!account) {
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="text-3xl font-bold tracking-tight">Staff account</h1>
        <Panel title="No account to show">
          <Note kind="error">
            {loadFailure ?? "This staff account could not be read."} Nothing has been changed — an account that cannot be
            read cannot be edited, and no form is shown for it.
          </Note>
        </Panel>
      </div>
    );
  }

  const isSelf = account.id === user.id;
  const when = (value: Date | null) => (value ? formatInZone(value, timeZone) : null);
  const liveSessions = account.sessions.filter((session) => session.expiresAt > now).length;
  const sections = capabilitiesFor(account.role);
  const isCustomer = account.role === "CUSTOMER";

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {account.name}
            {isSelf ? <span className="badge badge-brand ml-2 align-middle">You</span> : null}
          </h1>
          <p className="hint mt-1">
            {account.email}
            {account.phone ? ` · ${account.phone}` : ""} · {ROLE_LABELS[account.role]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge active={account.isActive} />
        </div>
      </div>

      {isSelf ? (
        <Note kind="error">
          This is the account you are signed in as. Two changes here end your own session: a role change and a password
          reset both delete every stored session for the account, which includes the one holding this page open. The
          service also refuses to demote or stop the last active owner, so if you are the only one the request is
          refused and nothing moves.
        </Note>
      ) : null}

      {isCustomer ? (
        <Note>
          This is a customer account, not a staff one. The staff update service refuses to change it — it says so in its
          own words rather than editing a guest from here — so the forms below are not offered. Customer accounts are
          read and corrected under Customers.
        </Note>
      ) : null}

      <Panel title="The account" description="Only the fields the staff detail read returns.">
        <Details
          rows={[
            { label: "Signs in as", value: account.email },
            { label: "Name on bills and in the log", value: account.name },
            { label: "Phone", value: account.phone ?? "None on file" },
            { label: "Role", value: ROLE_LABELS[account.role] },
            {
              label: "State",
              value: account.isActive ? "Active — can sign in" : "Stopped — sign-in is refused, the record stays",
            },
            { label: "Last sign-in", value: when(account.lastLoginAt) ?? "Never signed in" },
            { label: "Account added", value: when(account.createdAt) ?? "Unknown" },
            {
              label: "Sessions on record",
              value: `${liveSessions} still in date, of ${account.sessions.length} stored (this read shows up to 20)`,
            },
          ]}
        />
        <p className="hint mt-3">
          A session is the server-side record behind the sign-in cookie. Its identifier is never printed on a page; the
          counts are what a stop, a role change or a password reset wipes.
        </p>
      </Panel>

      <Panel
        title="What this role lets them do"
        description="The permission table itself, not a description written for this page."
      >
        {sections.length === 0 ? (
          <EmptyState title="No panel permissions">
            This role carries none of the panel&apos;s permissions, so there is nothing to list.
          </EmptyState>
        ) : (
          <dl className="space-y-3 text-sm">
            {sections.map((section) => (
              <div key={section.group}>
                <dt className="label">{section.label}</dt>
                <dd className="soft">{section.items.map((item) => `${item.label} (${item.permission})`).join("; ")}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="hint mt-3">
          The words in brackets are the permission names the route handlers check. Changing the role changes this list
          and nothing else: their orders, payments and audit entries are not touched.
        </p>
      </Panel>

      {!isCustomer ? (
        <>
          <Panel title="Change these details" description="Name, sign-in address and phone. This does not end their sessions.">
            <StaffAccountForm account={{ id: account.id, name: account.name, email: account.email, phone: account.phone }} isSelf={isSelf} />
          </Panel>

          <Panel
            title="Role and access"
            description="A role change or a stop deletes every session the account holds, so it takes effect at once rather than when the cookie expires."
          >
            <StaffAccessControls
              account={{
                id: account.id,
                name: account.name,
                email: account.email,
                role: account.role,
                isActive: account.isActive,
              }}
              isSelf={isSelf}
            />
            <p className="hint mt-3">
              There is no delete on this page, and none in the API behind it: the delete route performs exactly this
              stop, because orders, payments and audit rows keep naming the account that made them.
            </p>
          </Panel>

          <Panel
            title="Set a new password"
            description="For a lost password, or to take away one that was shared. The panel cannot read the current password back."
          >
            <StaffPasswordResetForm accountId={account.id} displayName={account.name} isSelf={isSelf} />
            <p className="hint mt-3">
              Setting a password here stores only its hash and revokes the account&apos;s sessions. Nothing marks the
              account as having to change it on the next sign-in, so what you type is what they use until the next
              reset — hand it over in person, the same way a newly created account&apos;s password is handed over.
            </p>
          </Panel>
        </>
      ) : null}

      <Panel
        title="What this account has done"
        description="Audit entries naming it as the actor, newest first — the same trail the log screen reads."
      >
        {activity.length === 0 ? (
          <EmptyState title="Nothing in the log yet">
            No action in the panel has been recorded against this account. That is usual for an account created and not
            yet used.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{auditActionLabel(entry.action)}</span>
                  {auditActionLabel(entry.action) !== entry.action ? (
                    <span className="hint block font-mono">{entry.action}</span>
                  ) : null}
                </span>
                <span className="muted">
                  {entry.entityType}
                  {entry.entityId ? <span className="hint block break-all font-mono">{entry.entityId}</span> : null}
                </span>
                <span className="muted">{when(entry.createdAt) ?? "Unknown time"}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="label">Orders placed under this account</dt>
            <dd className="soft">{account._count.ordersCreated} — as a guest, not taken at the counter</dd>
          </div>
          <div>
            <dt className="label">Payments recorded</dt>
            <dd className="soft">{account._count.paymentsTaken}</dd>
          </div>
          <div>
            <dt className="label">Refunds recorded</dt>
            <dd className="soft">{account._count.refundsIssued}</dd>
          </div>
        </dl>
        <p className="hint mt-3">
          The list above holds the last entries only, and the amounts a person took are not carried here — they are on
          the bills and payments screens. Before and after values for each entry live in the log itself.
        </p>
      </Panel>

      <p className="hint">
        Account id <span className="font-mono">{account.id}</span>. It is the whole of this address, and it names no
        password or session.
      </p>
    </div>
  );
}

export default function AdminStaffAccountPage(props: PageProps<"/admin/staff/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <StaffAccountDetail params={props.params} />
    </Suspense>
  );
}
