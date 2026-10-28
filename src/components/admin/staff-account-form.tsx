"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * The identity fields of one account, sent to `PATCH /api/admin/staff/[id]`.
 *
 * Only the fields that actually changed go in the body: the patch schema is
 * strict and the service reads a missing field as "leave it alone", so sending
 * everything would mean sending back values that may have changed on the server
 * while this page sat open. Role and active state are not here — they sit in the
 * access panel, because those two are the changes that end someone's sessions.
 */

export type StaffProfileFields = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

export function StaffAccountForm({
  account,
  isSelf = false,
}: {
  account: StaffProfileFields;
  isSelf?: boolean;
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [phone, setPhone] = useState(account.phone ?? "");

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();

  const patch: Record<string, string> = {};
  if (trimmedName !== account.name) patch.name = trimmedName;
  if (trimmedEmail.toLowerCase() !== account.email) patch.email = trimmedEmail;
  if (trimmedPhone && trimmedPhone !== (account.phone ?? "")) patch.phone = trimmedPhone;

  const changed = Object.keys(patch).length > 0;
  const blankPhoneCleared = trimmedPhone === "" && (account.phone ?? "") !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!changed) return;
    const saved = await run<{ id: string; name: string; email: string; phone: string | null }>(
      "PATCH",
      `/api/admin/staff/${account.id}`,
      patch,
    );
    if (!saved) return;
    setName(saved.name);
    setEmail(saved.email);
    setPhone(saved.phone ?? "");
    setNotice(
      `Saved: ${saved.name}, ${saved.email}${saved.phone ? `, ${saved.phone}` : ""}. ` +
        "Their password and their signed-in devices are untouched by this change.",
    );
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="staff-name">
            Name
          </label>
          <input
            id="staff-name"
            className="input mt-1"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor="staff-email">
            Sign-in email
          </label>
          <input
            id="staff-email"
            className="input mt-1"
            type="email"
            required
            maxLength={160}
            autoComplete="off"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="staff-phone">
            Phone
          </label>
          <input
            id="staff-phone"
            className="input mt-1"
            inputMode="tel"
            maxLength={20}
            autoComplete="off"
            placeholder={account.phone ?? "No number on file"}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
          <p className="hint mt-1">
            A Bangladeshi mobile number, such as 01712345678 or +8801712345678. Empty is read as &ldquo;nothing
            supplied&rdquo;, so a number already on file cannot be removed from this screen — the API has no way to ask
            for that.
          </p>
        </div>
      </div>

      {blankPhoneCleared ? (
        <p className="notice">
          You cleared the number. Sending this leaves the stored one exactly as it is — put the digits back or leave the
          field as it was.
        </p>
      ) : null}

      {isSelf ? (
        <p className="notice">
          This is the account you are signed in as. Changing the sign-in address does not sign you out now, but the next
          time you sign in it is the new address that works. Make sure nobody else already uses it — if they do, the
          server refuses and nothing changes.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !changed}>
          {busy ? "Saving…" : "Save these details"}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy}
          onClick={() => {
            setName(account.name);
            setEmail(account.email);
            setPhone(account.phone ?? "");
            setNotice(null);
            setError(null);
          }}
        >
          Discard my changes
        </button>
      </div>
      <p className="hint">
        {changed
          ? `Ready to send: ${Object.keys(patch).join(", ")}. Nothing changes until the server accepts it; if it refuses, its own words appear above and your edits stay on screen.`
          : "Nothing to send yet — every field matches what is stored."}
      </p>
    </form>
  );
}
