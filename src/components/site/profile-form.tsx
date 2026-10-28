"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";

export function ProfileForm({ initial }: { initial: { name: string; phone: string; address: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await apiFetch<{ name: string }>("/api/me/profile", {
      method: "PATCH",
      body: { name: name.trim(), phone: phone.trim(), address: address.trim() || null },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="pf-name">
          Name
        </label>
        <input id="pf-name" className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      <div>
        <label className="label" htmlFor="pf-phone">
          Mobile number
        </label>
        <input id="pf-phone" className="input mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" maxLength={20} />
      </div>
      <div>
        <label className="label" htmlFor="pf-address">
          Delivery address (optional)
        </label>
        <textarea id="pf-address" className="textarea mt-1" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
        <p className="hint mt-1">
          Saved here only so you can paste it into an order. Staff notes about an account are never written to this
          screen.
        </p>
      </div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {message ? <p className="notice notice-ok">{message}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

export function PasswordChangeForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await apiFetch<{ reauthenticate?: boolean }>("/api/auth/password/change", {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setCurrent("");
    setNext("");
    if (response.data.reauthenticate) {
      // Changing a password revokes every session, including this one, so the
      // honest next step is the sign-in page — not a profile that is already dead.
      setMessage("Password changed. Every device was signed out; sign in again with the new one.");
      router.refresh();
      window.setTimeout(() => router.push("/login"), 1800);
    } else {
      setMessage("Password changed.");
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="pc-current">
          Current password
        </label>
        <input id="pc-current" className="input mt-1" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor="pc-new">
          New password
        </label>
        <input id="pc-new" className="input mt-1" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <p className="hint mt-1">At least 10 characters, mixing letters, numbers and a symbol.</p>
      </div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {message ? <p className="notice notice-ok">{message}</p> : null}
      <button type="submit" className="btn btn-outline" disabled={busy}>
        {busy ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
