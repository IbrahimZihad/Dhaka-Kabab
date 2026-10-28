"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Setting a password for someone else, which is what `adminSetPassword` does:
 * hash it, then delete every stored session for that account and write one audit
 * row (`auth.password.admin_reset`). The password is never read back — there is
 * no column holding it in plain form and no endpoint that returns one, and the
 * schema has no "must change password" flag, so whatever is typed here is the
 * password that account keeps using until someone types another one.
 *
 * The courtesy checks below mirror the server's own rules so an obvious mistake
 * is caught before a request is sent. The server remains the authority: its
 * refusal is what is displayed if a rule here is wrong or missing.
 */

const COMMON_PREFIXES = ["password", "123456", "qwerty", "dhaka", "kabab"];

function courtesyProblems(value: string, repeat: string): string[] {
  const problems: string[] = [];
  if (value.length < 10) problems.push("Use at least 10 characters.");
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) problems.push("Mix upper and lower case letters.");
  if (!/\d/.test(value)) problems.push("Include at least one digit.");
  if (COMMON_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix))) problems.push("Do not start with a common word.");
  if (value.length > 200) problems.push("That is longer than the panel accepts.");
  if (repeat.length === 0) problems.push("Type it a second time so a slip of the fingers is not saved as their password.");
  else if (value !== repeat) problems.push("The two entries do not match.");
  return problems;
}

export function StaffPasswordResetForm({
  accountId,
  displayName,
  isSelf = false,
  compact = false,
}: {
  accountId: string;
  displayName: string;
  isSelf?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  const problems = password.length > 0 || repeat.length > 0 ? courtesyProblems(password, repeat) : [];

  function clearFields() {
    setPassword("");
    setRepeat("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length > 0) return;
    const saved = await run<{ id: string; email: string }>("POST", `/api/admin/staff/${accountId}/password`, {
      newPassword: password,
    });
    if (!saved) return;
    clearFields();
    setNotice(
      `A new password is set for ${saved.email}. Every session that account had is now deleted, so it is signed out of ` +
        "every till and device and has to sign in again with what you just typed." +
        (isSelf ? " That included this browser — sign in again to carry on." : "") +
        " This screen cannot show the password back to you afterwards.",
    );
    router.refresh();
  }

  const body = (
    <form onSubmit={submit} className="space-y-3">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`new-password-${accountId}`}>
            New password for {displayName}
          </label>
          <input
            id={`new-password-${accountId}`}
            className="input mt-1"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setNotice(null);
              setError(null);
            }}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor={`repeat-password-${accountId}`}>
            Type it again
          </label>
          <input
            id={`repeat-password-${accountId}`}
            className="input mt-1"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value);
              setNotice(null);
              setError(null);
            }}
            disabled={busy}
          />
        </div>
      </div>

      <p className="hint">
        The same rules the server applies: at least 10 characters, upper and lower case together, at least one digit,
        and not beginning with a common word such as the restaurant&apos;s name. Nothing in this panel shows a stored
        password again, to you or to anyone else.
      </p>

      {isSelf ? (
        <p className="notice notice-error">
          This is the account you are signed in as. Setting a password here deletes this session too, so you will be
          signed straight out and must sign in again with the new one.
        </p>
      ) : null}

      {problems.length > 0 ? (
        <div className="notice notice-error">
          <p className="font-semibold">Not ready to send yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || problems.length > 0 || password.length === 0}>
          {busy ? "Setting it…" : "Set this password"}
        </button>
        {password.length > 0 || repeat.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={clearFields}>
            Clear the fields
          </button>
        ) : null}
      </div>
      <p className="hint">
        Nothing happens until the server accepts this. If it refuses, its own message is shown above and no password was
        changed.
      </p>
    </form>
  );

  if (!compact) return body;

  return (
    <details className="min-w-56">
      <summary className="cursor-pointer text-sm font-semibold">Reset password</summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}
