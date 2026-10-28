"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/** The editable fields as the customer service stored them. Passwords, email and
 *  role are not touched here — this form only amends the profile. */
export type CustomerEditable = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

type SavedUser = { id: string; name: string; isActive: boolean };

/**
 * A staff edit of one customer, sent to the same endpoint the guests' own account
 * screen does not reach. Nothing is reported as saved until the server answers;
 * a refusal (an invalid number, a phone another account already uses) is shown in
 * the server's own words and the form stays open.
 */
export function CustomerEditForm({ customer }: { customer: CustomerEditable }) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();

  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [isActive, setIsActive] = useState(customer.isActive);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("Enter the customer's name — at least two characters.");
      return;
    }
    const saved = await run<SavedUser>("PATCH", `/api/admin/customers/${customer.id}`, {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      notes: notes.trim(),
      isActive,
    });
    if (!saved) return;
    setNotice(`Saved. ${saved.name} is now ${saved.isActive ? "active" : "deactivated"}.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`cust-name-${customer.id}`}>
            Name
          </label>
          <input
            id={`cust-name-${customer.id}`}
            className="input mt-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            minLength={2}
          />
        </div>
        <div>
          <label className="label" htmlFor={`cust-phone-${customer.id}`}>
            Mobile number
          </label>
          <input
            id={`cust-phone-${customer.id}`}
            className="input mt-1"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="01712345678"
            maxLength={20}
          />
          <p className="hint mt-1">A Bangladeshi mobile number. The server refuses a number another account already uses.</p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`cust-address-${customer.id}`}>
          Delivery address
        </label>
        <textarea
          id={`cust-address-${customer.id}`}
          className="textarea mt-1"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          maxLength={300}
          rows={2}
        />
        <p className="hint mt-1">Clearing this box and saving removes the stored address.</p>
      </div>

      <div>
        <label className="label" htmlFor={`cust-notes-${customer.id}`}>
          Internal note
        </label>
        <textarea
          id={`cust-notes-${customer.id}`}
          className="textarea mt-1"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Allergies, regular orders, anything the counter should know. Never shown to the customer."
        />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
        <input
          id={`cust-active-${customer.id}`}
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="mt-1"
        />
        <span>
          Account is active. Unticking deactivates it: the customer can no longer sign in and every one of their open
          sessions is ended immediately.
        </span>
      </label>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Saving…" : "Save changes"}
      </button>
      <p className="hint ml-2 inline">
        Money is never edited here — spend is read from the customer&apos;s stored orders and cannot be typed in.
      </p>
    </form>
  );
}
