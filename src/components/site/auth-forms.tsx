"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";

type FieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
};

function Field({ id, label, type = "text", value, onChange, autoComplete, hint, placeholder, required, maxLength }: FieldProps) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input mt-1"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
      />
      {hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  );
}

function Notice({ error, ok: okay }: { error: string | null; ok?: string | null }) {
  if (error) return <p className="notice notice-error">{error}</p>;
  if (okay) return <p className="notice notice-ok">{okay}</p>;
  return null;
}

export function LoginForm({ staffHint }: { staffHint?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ role: string }>("/api/auth/login", {
      method: "POST",
      body: { email: email.trim(), password },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    // Where you land is decided by the role we read back, not by a guess.
    router.push(response.data.role === "CUSTOMER" ? "/account" : "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <Field id="login-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" required />
      <Field id="login-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
      <Notice error={error} />
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/reset-password" className="hover:text-brand">
          Forgotten password?
        </Link>
        <Link href="/register" className="hover:text-brand">
          Create an account
        </Link>
      </div>
      {staffHint ? <p className="hint">{staffHint}</p> : null}
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ id: string }>("/api/auth/register", {
      method: "POST",
      body: { name: name.trim(), email: email.trim(), phone: phone.trim(), password },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <Field id="rg-name" label="Your name" value={name} onChange={setName} autoComplete="name" required />
      <Field id="rg-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
      <Field id="rg-phone" label="Mobile number" value={phone} onChange={setPhone} autoComplete="tel" placeholder="01712345678" required />
      <Field
        id="rg-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        required
        hint="At least 10 characters, with a mix of letters, numbers and a symbol."
      />
      <Notice error={error} />
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Creating your account…" : "Create account"}
      </button>
      <p className="hint">
        An account is a convenience, not a requirement — you can order, book and pay as a guest. It keeps your past
        orders and bookings in one place.
      </p>
    </form>
  );
}

export function ResetStartForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ message: string }>("/api/auth/password/reset", {
      method: "POST",
      body: { email: email.trim() },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setSent(response.data.message);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <Field id="rs-email" label="Account email" type="email" value={email} onChange={setEmail} required />
      <Notice error={error} ok={sent} />
      {sent ? (
        <p className="hint">
          Email delivery is configured by the restaurant. If nothing arrives, ask staff to reset it at the counter.
        </p>
      ) : (
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Sending…" : "Send me a reset link"}
        </button>
      )}
    </form>
  );
}

export function ResetCompleteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ message: string }>("/api/auth/password/reset/complete", {
      method: "POST",
      body: { token, newPassword: password },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setDone(response.data.message);
    window.setTimeout(() => router.push("/login"), 1500);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <Field id="rc-password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required hint="At least 10 characters, mixed." />
      <Field id="rc-confirm" label="Repeat the new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
      <Notice error={error} ok={done} />
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !token}>
        {busy ? "Changing…" : "Change my password"}
      </button>
      {!token ? <p className="hint">This link is incomplete — ask for a fresh reset email.</p> : null}
    </form>
  );
}
