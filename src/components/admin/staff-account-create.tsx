"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { STAFF_ROLE_VALUES, capabilitiesFor, permissionCount, totalPermissionCount } from "@/components/admin/staff-capability-map";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Creating an account. The form has no password field on purpose: the body is
 * sent without one, so `createStaff` mints a password itself and returns it in
 * this response alone. It is held in component state from that response only —
 * never in the address bar, never in a link, never rendered by the server, never
 * logged — and it disappears from the page when the block below is dismissed.
 *
 * The account is created active, so the first sign-in works immediately, and the
 * schema carries no "must change password" flag: what this block prints is the
 * password that account keeps using until someone sets another one, either on the
 * account's own page or through the reset control here.
 */

type CreatedAccount = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
};

export function StaffAccountCreate() {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("CASHIER");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  const chosenRole = STAFF_ROLE_VALUES.includes(role as UserRole) ? (role as UserRole) : "CASHIER";

  function resetFields() {
    setName("");
    setEmail("");
    setPhone("");
    setRole("CASHIER");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (tempPassword) {
      setError("Deal with the password below before creating another account — this screen shows each one only once.");
      return;
    }
    const result = await run<{ user: CreatedAccount; tempPassword: string | null }>("POST", "/api/admin/staff", {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() ? phone.trim() : undefined,
      role: chosenRole,
      isActive: true,
    });
    if (!result) return;
    setCreated(result.user);
    setTempPassword(result.tempPassword);
    resetFields();
    setNotice(result.tempPassword ? null : "The account was created with the password you supplied.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="staff-new-name">
            Name
          </label>
          <input
            id="staff-new-name"
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
          <p className="hint mt-1">As it should read on a bill or in the log.</p>
        </div>
        <div>
          <label className="label" htmlFor="staff-new-email">
            Sign-in email
          </label>
          <input
            id="staff-new-email"
            className="input mt-1"
            type="email"
            required
            maxLength={160}
            autoComplete="off"
            placeholder="name@restaurant…"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
          <p className="hint mt-1">Saved in lower case. One account per address.</p>
        </div>
        <div>
          <label className="label" htmlFor="staff-new-phone">
            Phone (optional)
          </label>
          <input
            id="staff-new-phone"
            className="input mt-1"
            inputMode="tel"
            maxLength={20}
            autoComplete="off"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
          <p className="hint mt-1">A Bangladeshi mobile number, 01 and nine digits.</p>
        </div>
        <div>
          <label className="label" htmlFor="staff-new-role">
            Role
          </label>
          <select
            id="staff-new-role"
            className="select mt-1"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setError(null);
            }}
            disabled={busy}
          >
            {STAFF_ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="hint mt-1">
            {ROLE_LABELS[chosenRole]}: {permissionCount(chosenRole)} of the {totalPermissionCount()} abilities in the
            panel. The list below says exactly which.
          </p>
        </div>
      </div>

      <ul className="space-y-1 text-sm soft">
        {capabilitiesFor(chosenRole).map((section) => (
          <li key={section.group}>
            <span className="label">{section.label}: </span>
            {section.items.map((item) => item.label).join(", ")}
          </li>
        ))}
      </ul>

      {error ? <p className="notice notice-error">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create the account"}
        </button>
        <p className="hint">
          A new account is created ready to use, with a password this panel generates. There is no forced change on the
          first sign-in in this build, so hand the password over in person and set another one on the account&apos;s page
          when they have a device of their own.
        </p>
      </div>

      {tempPassword && created ? (
        <OneTimePasswordBlock password={tempPassword} account={created} onDone={() => {
          setTempPassword(null);
          setCreated(null);
        }} />
      ) : null}

      {!tempPassword && notice ? <p className="notice notice-ok">{notice}</p> : null}
    </form>
  );
}

/**
 * The one-time block. It is only ever rendered with a value that arrived in the
 * response of the request that just ran, and dismissing it removes the password
 * from the page for good.
 */
function OneTimePasswordBlock({
  password,
  account,
  onDone,
}: {
  password: string;
  account: CreatedAccount;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-paper-raised p-4">
      <p className="label text-danger">One-time password for {account.email}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="select-all rounded-md border border-line bg-paper px-3 py-2 font-mono text-lg tracking-wide">
          {password}
        </code>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy it"}
        </button>
      </div>

      <p className="notice notice-error mt-3">
        This is the only time the panel will show this password. It is hashed the moment it is stored and nothing — not
        this screen, not the database read-back, not an owner — can print it again. If it is lost, the only way forward
        is to set a new one from the account&apos;s page.
      </p>
      <p className="hint mt-2">
        There is no forced change on first sign-in in this build, so this password keeps working until somebody changes
        it. Hand it to {account.name} in person. Do not put it in an email, a group message or a note on the counter:
        anyone holding it is holding a {ROLE_LABELS[account.role]} account.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/admin/staff/${account.id}`} className="btn btn-primary btn-sm">
          Open the account
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          I have handed it over — hide this
        </button>
      </div>
      <p className="hint mt-2">
        Hiding it removes the password from this page. The address of the account page holds nothing but the account id.
      </p>
    </div>
  );
}
