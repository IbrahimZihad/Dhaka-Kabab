"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { STAFF_ROLE_VALUES, permissionCount } from "@/components/admin/staff-capability-map";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Role and state for one account. Both go to the same endpoint the panel's own
 * API uses (`PATCH /api/admin/staff/[id]`), and the words below come from what
 * `staff.service.ts` actually does:
 *
 *  - a role change or a stop deletes every stored session for that account, so
 *    they are signed out on every device at once rather than at cookie expiry;
 *  - there is no delete. `DELETE /api/admin/staff/[id]` calls the same
 *    deactivation as a stop, because orders, payments and audit rows name this
 *    account and removing it would rewrite financial history;
 *  - the service refuses to demote or stop the last active owner, and that
 *    refusal is shown here in the server's own words.
 */

export type StaffAccountSummary = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

export function StaffAccessControls({
  account,
  isSelf,
  compact = false,
}: {
  account: StaffAccountSummary;
  isSelf: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [role, setRole] = useState<string>(account.role);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const roleChanged = role !== account.role;
  const demotesSelf = isSelf && account.role === "OWNER" && role !== "OWNER";
  const chosenCount = STAFF_ROLE_VALUES.includes(role as UserRole) ? permissionCount(role as UserRole) : 0;
  const currentCount = permissionCount(account.role);

  async function saveRole() {
    const updated = await run<{ id: string; role: UserRole }>("PATCH", `/api/admin/staff/${account.id}`, { role });
    if (!updated) return;
    setNotice(
      `${account.name} is now a ${ROLE_LABELS[updated.role]}. Every stored session for the account was deleted, so the ` +
        "next sign-in is judged by the new role." +
        (isSelf ? " That includes this browser: you are signed out and have to sign in again." : ""),
    );
    router.refresh();
  }

  async function setActive(next: boolean) {
    const updated = await run<{ id: string; isActive: boolean }>("PATCH", `/api/admin/staff/${account.id}`, {
      isActive: next,
    });
    if (!updated) return;
    setConfirmingStop(false);
    setNotice(
      next
        ? `${account.name} can sign in again with the password they already hold. Nothing about their past work was changed.`
        : `${account.name} is stopped. Every stored session was deleted, so signing in is now refused for that account. ` +
            "Their orders, payments and audit entries stay exactly as they were — this is not a deletion." +
            (isSelf
              ? " You were signed out of this browser by the same action, and only another active owner can start this account again."
              : ""),
    );
    router.refresh();
  }

  const body = (
    <div className="space-y-3">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div>
        <label className="label" htmlFor={`role-${account.id}`}>
          Role
        </label>
        <select
          id={`role-${account.id}`}
          className="select mt-1"
          value={role}
          disabled={busy}
          onChange={(event) => {
            setRole(event.target.value);
            setNotice(null);
            setError(null);
          }}
        >
          {STAFF_ROLE_VALUES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        <p className="hint mt-1">
          {roleChanged
            ? `A ${ROLE_LABELS[role as UserRole]} holds ${chosenCount} of the ${permissionCount("OWNER")} abilities the panel has, against ${currentCount} today. The endpoints, not this screen, enforce the difference.`
            : "Choose a different role to save a change. The full list of what each role covers is on this page."}
        </p>
      </div>

      {demotesSelf ? (
        <p className="notice notice-error">
          This is the account you are signed in as. Moving it off {ROLE_LABELS.OWNER} takes away the right to open this
          screen at all — you would no longer be able to change staff accounts, including putting yourself back. The
          service also refuses to demote the last active owner, so if you are the only one the save will be refused and
          nothing changes.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !roleChanged} onClick={() => void saveRole()}>
          {busy ? "Sending…" : roleChanged ? `Save as ${ROLE_LABELS[role as UserRole]}` : "Role unchanged"}
        </button>
      </div>

      <div className="border-t border-line pt-3">
        <p className="label">Access state</p>
        <p className="hint mt-1">
          {account.isActive
            ? "Active: this account can sign in with the password it holds."
            : "Stopped: sign-in is refused, but the account and everything attributed to it remain on file."}
        </p>
        {account.isActive ? (
          confirmingStop ? (
            <div className="mt-2 space-y-2 rounded-md border border-line p-3">
              <p className="text-sm soft">
                Stopping {isSelf ? "your own account" : account.name} does not delete it. Orders they placed, payments
                they recorded and audit entries naming them all stay readable, on bills and in the log — the panel keeps
                the history attributable to a real account. It does end their sign-in sessions immediately, and this is
                the only kind of removal the staff API offers.
                {isSelf
                  ? " This is the account you are signed in as: you would be locked out of the whole panel, not only this screen."
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void setActive(false)}>
                  {busy ? "Sending…" : isSelf ? "Confirm: stop my own account" : "Confirm: stop this account"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingStop(false)}>
                  Leave it active
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm mt-2"
              disabled={busy}
              onClick={() => {
                setConfirmingStop(true);
                setNotice(null);
                setError(null);
              }}
            >
              Stop this account
            </button>
          )
        ) : (
          <button type="button" className="btn btn-outline btn-sm mt-2" disabled={busy} onClick={() => void setActive(true)}>
            {busy ? "Sending…" : "Let them sign in again"}
          </button>
        )}
      </div>
    </div>
  );

  if (!compact) return body;

  return (
    <details className="min-w-56">
      <summary className="cursor-pointer text-sm font-semibold">Change role or access</summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}
