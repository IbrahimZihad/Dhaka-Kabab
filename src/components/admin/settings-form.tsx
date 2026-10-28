"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { OpeningHourRule } from "@/lib/time";
import { parseOpeningHours } from "@/lib/time";
import { poisaToInputValue } from "@/lib/money";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/admin/admin-ui";
import { SettingsIdentityForm } from "@/components/admin/settings-identity-form";
import { SettingsHoursForm } from "@/components/admin/settings-hours-editor";
import { SettingsChargesForm } from "@/components/admin/settings-charges-form";
import { SettingsChannelsForm, SettingsReservationsForm } from "@/components/admin/settings-channels-form";
import { SettingsPaymentsForm, type GatewayReadinessView } from "@/components/admin/settings-payments-section";
import {
  SettingsServicesForm,
  type ChatHealthView,
  type EmailHealthView,
} from "@/components/admin/settings-services-section";
import { SettingsReceiptForm } from "@/components/admin/settings-receipt-form";

/**
 * The owner's settings, saved one section at a time.
 *
 * Each panel below is its own form with its own Save button. The PATCH route
 * validates a complete settings body (see src/server/validation/settings.ts),
 * so a section never sends only its own fields: `buildPayload` starts from the
 * row that is currently saved and merges in what the section edited. Money
 * crosses the wire in the units the server expects and never twice converted:
 *   - deliveryFeePoisa and reservationDepositPoisa are sent as TAKA text
 *     ("60.00"); the server's `pricePoisa` transform turns that into poisa;
 *   - serviceChargeBps and vatBps are integers of basis points (1000 = 10%),
 *     computed once here from the percent the owner typed;
 *   - every other field is sent as the plain stored value.
 * Nothing credential-shaped is ever read into this tree: the row handed down by
 * the page deliberately has no paymentStoreId, and no panel renders a secret.
 */

/** The settings row as stored, minus every secret column. */
export type SettingsRow = {
  name: string;
  logoUrl: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  country: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  emailPublic: string;
  mapsUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  contactNote: string | null;
  timezone: string;
  currencyCode: string;
  currencySymbol: string;
  openingHours: OpeningHourRule[];
  serviceChargeBps: number;
  vatBps: number;
  vatOnServiceCharge: boolean;
  roundingStepPoisa: number;
  reservationSlotMinutes: number;
  reservationDurationMinutes: number;
  reservationBufferMinutes: number;
  reservationMaxDaysAhead: number;
  reservationCutoffMinutes: number;
  reservationDepositPoisa: number;
  requirePolicyAcceptance: boolean;
  allowDineIn: boolean;
  allowTakeaway: boolean;
  allowDelivery: boolean;
  deliveryFeePoisa: number;
  autoConfirmOrders: boolean;
  enablePartialPayments: boolean;
  paymentProvider: string;
  chatbotEnabled: boolean;
  chatbotFallbackOnly: boolean;
  emailNotificationsEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
};

/** The complete PATCH body, in wire units: taka as typed text, bps as integers. */
export type SettingsWire = {
  name: string;
  logoUrl: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  country: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  emailPublic: string;
  mapsUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  contactNote: string | null;
  timezone: string;
  currencyCode: string;
  currencySymbol: string;
  openingHours: OpeningHourRule[];
  serviceChargeBps: number;
  vatBps: number;
  vatOnServiceCharge: boolean;
  roundingStepPoisa: number;
  reservationSlotMinutes: number;
  reservationDurationMinutes: number;
  reservationBufferMinutes: number;
  reservationMaxDaysAhead: number;
  reservationCutoffMinutes: number;
  /** Taka text — the server converts to poisa. Never multiplied here. */
  reservationDepositPoisa: string;
  requirePolicyAcceptance: boolean;
  allowDineIn: boolean;
  allowTakeaway: boolean;
  allowDelivery: boolean;
  /** Taka text — the server converts to poisa. Never multiplied here. */
  deliveryFeePoisa: string;
  autoConfirmOrders: boolean;
  enablePartialPayments: boolean;
  paymentProvider: "simulated" | "sslcommerz";
  chatbotEnabled: boolean;
  chatbotFallbackOnly: boolean;
  emailNotificationsEnabled: boolean;
  receiptFooter: string;
  receiptHeader: string;
};

/** Shape of the API's PATCH answer: the stored row; openingHours is raw Json. */
export type SaveResponse = {
  settings: Omit<SettingsRow, "openingHours"> & { openingHours: unknown };
  message?: string;
};

export function parseRow(raw: SaveResponse["settings"]): SettingsRow {
  return {
    ...raw,
    openingHours: parseOpeningHours(raw.openingHours),
  };
}

/** The whole body as currently saved, in wire units; a section merges its edits in. */
export function currentPayload(row: SettingsRow): SettingsWire {
  return {
    name: row.name,
    logoUrl: row.logoUrl,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    country: row.country,
    phonePrimary: row.phonePrimary,
    phoneSecondary: row.phoneSecondary,
    emailPublic: row.emailPublic,
    mapsUrl: row.mapsUrl,
    facebookUrl: row.facebookUrl,
    instagramUrl: row.instagramUrl,
    contactNote: row.contactNote,
    timezone: row.timezone,
    currencyCode: row.currencyCode,
    currencySymbol: row.currencySymbol,
    openingHours: row.openingHours.map((rule) => ({ days: [...rule.days], opens: rule.opens, closes: rule.closes })),
    serviceChargeBps: row.serviceChargeBps,
    vatBps: row.vatBps,
    vatOnServiceCharge: row.vatOnServiceCharge,
    roundingStepPoisa: row.roundingStepPoisa,
    reservationSlotMinutes: row.reservationSlotMinutes,
    reservationDurationMinutes: row.reservationDurationMinutes,
    reservationBufferMinutes: row.reservationBufferMinutes,
    reservationMaxDaysAhead: row.reservationMaxDaysAhead,
    reservationCutoffMinutes: row.reservationCutoffMinutes,
    // Taka text, straight from the stored poisa. The server's transform re-poais it.
    reservationDepositPoisa: poisaToInputValue(row.reservationDepositPoisa),
    requirePolicyAcceptance: row.requirePolicyAcceptance,
    allowDineIn: row.allowDineIn,
    allowTakeaway: row.allowTakeaway,
    allowDelivery: row.allowDelivery,
    deliveryFeePoisa: poisaToInputValue(row.deliveryFeePoisa),
    autoConfirmOrders: row.autoConfirmOrders,
    enablePartialPayments: row.enablePartialPayments,
    paymentProvider: normaliseProvider(row.paymentProvider),
    chatbotEnabled: row.chatbotEnabled,
    chatbotFallbackOnly: row.chatbotFallbackOnly,
    emailNotificationsEnabled: row.emailNotificationsEnabled,
    receiptFooter: row.receiptFooter,
    receiptHeader: row.receiptHeader,
  };
}

export function normaliseProvider(value: string): "simulated" | "sslcommerz" {
  return value.trim().toLowerCase() === "sslcommerz" ? "sslcommerz" : "simulated";
}

/** Props every section form receives: the currently saved row and its save callback. */
export type SectionProps = {
  row: SettingsRow;
  onSaved: (next: SettingsRow) => void;
};

/**
 * A section's draft, kept in the units a person reads, without any effect:
 * while the owner edits, the draft is the edited value; the moment it is saved
 * or discarded it falls back to being derived from the saved row. Another
 * section's save therefore updates this one unless it has unsaved edits — which
 * are never silently thrown away.
 */
export function useTrackedDraft<T>(row: SettingsRow, fromRow: (row: SettingsRow) => T) {
  const [edited, setEdited] = useState<{ value: T } | null>(null);
  const draft: T = edited ? edited.value : fromRow(row);

  const setValue = useCallback((value: T) => {
    setEdited({ value });
  }, []);

  const update = useCallback(
    (patch: Partial<T>) => {
      setEdited((current) => ({
        value: { ...(current ? current.value : fromRow(row)), ...patch },
      }));
    },
    [fromRow, row],
  );

  /** Return to deriving from the saved row — used by Discard and after a save. */
  const reset = useCallback(() => setEdited(null), []);
  const markSaved = reset;

  return { draft, update, setValue, reset, markSaved, dirty: edited !== null };
}

/** Shared labelled text input for the section forms. */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  maxLength,
  inputMode,
  optional = false,
  invalid = false,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  maxLength?: number;
  inputMode?: "decimal" | "tel" | "email" | "url" | "text";
  optional?: boolean;
  invalid?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {optional ? <span className="muted font-normal"> (optional)</span> : null}
      </label>
      <input
        id={id}
        className="input"
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  );
}

/** Shared whole-number input; the hint states the accepted range. */
export function NumberField({
  id,
  label,
  unit,
  value,
  hint,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  hint?: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} <span className="muted font-normal">({unit})</span>
      </label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode="numeric"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p className={`hint mt-1 ${invalid ? "text-danger" : ""}`}>
          {invalid ? "Whole numbers in the stated range only. " : ""}
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Shared checkbox with a plain-English consequence under the label. */
export function ToggleField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <label className="flex items-start gap-2 text-sm font-semibold" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {label}
          {hint ? <span className="hint mt-0.5 block font-normal">{hint}</span> : null}
        </span>
      </label>
    </div>
  );
}

/** A taka-typed amount that shows the resulting stored figure right under the field. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  resultLabel,
  invalid,
  hint,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  resultLabel: ReactNode;
  invalid: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="hint mt-1">
        {invalid ? <span className="text-danger">Not a usable amount. </span> : null}
        {resultLabel}
        {hint ? ` ${hint}` : ""}
      </p>
    </div>
  );
}

export function SettingsForm({
  settings,
  gateway,
  chat,
  email,
  callbackUrl,
}: {
  settings: SettingsRow;
  gateway: GatewayReadinessView;
  chat: ChatHealthView;
  email: EmailHealthView;
  callbackUrl: string;
}) {
  const router = useRouter();
  const [row, setRow] = useState<SettingsRow>(settings);

  function handleSaved(next: SettingsRow) {
    setRow(next);
    // Re-render the server-read cards above so "in force" figures match the row.
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <SettingsIdentityForm row={row} onSaved={handleSaved} />

      <Panel title="How saving works" description="Each section saves on its own.">
        <p className="text-sm soft">
          Every panel below is a separate request to the server, and it PATCHes the whole settings row with only that
          panel&apos;s fields changed. Nothing is applied before the server answers; if a panel reports a refusal, the
          values stay exactly as you typed them. Saving one panel does not discard another panel&apos;s unsaved edits,
          but each panel must be saved in turn — there is no draft state between them.
        </p>
      </Panel>

      <SettingsHoursForm row={row} onSaved={handleSaved} />
      <SettingsChargesForm row={row} onSaved={handleSaved} />
      <SettingsChannelsForm row={row} onSaved={handleSaved} />
      <SettingsReservationsForm row={row} onSaved={handleSaved} />
      <SettingsPaymentsForm row={row} gateway={gateway} callbackUrl={callbackUrl} onSaved={handleSaved} />
      <SettingsServicesForm row={row} chat={chat} email={email} onSaved={handleSaved} />
      <SettingsReceiptForm row={row} onSaved={handleSaved} />
    </div>
  );
}

export function SettingsFormSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-72" />
      {Array.from({ length: 5 }).map((_, index) => (
        <span key={index} className="skeleton block h-56" />
      ))}
    </div>
  );
}
