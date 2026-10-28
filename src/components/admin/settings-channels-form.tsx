"use client";

import { Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import { formatPoisa, parseMoneyInput, poisaToInputValue } from "@/lib/money";
import {
  MoneyField,
  NumberField,
  ToggleField,
  currentPayload,
  parseRow,
  useTrackedDraft,
  type SaveResponse,
  type SectionProps,
  type SettingsRow,
  type SettingsWire,
} from "@/components/admin/settings-form";

/**
 * Ordering channels and reservations. The delivery fee and the booking deposit
 * are typed in TAKA and sent as the typed text; the server's `pricePoisa`
 * transform converts once into poisa. Multiplying here instead would charge
 * every guest a hundred times too much, so nothing in this file ever does it —
 * the hint under each field prints the resulting ৳ figure so a mistake is visible
 * before the save, not after.
 */

const POISA_MAX = 100_000_000; // the server's "unrealistically large" bound

function takaField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const poisa = parseMoneyInput(trimmed);
  if (poisa === null || poisa < 0 || poisa > POISA_MAX) return null;
  return poisa;
}

function intInRange(raw: string, min: number, max: number): number | null {
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

type ChannelsDraft = {
  allowDineIn: boolean;
  allowTakeaway: boolean;
  allowDelivery: boolean;
  deliveryFeeTaka: string;
  autoConfirmOrders: boolean;
};

function channelsFromRow(row: SettingsRow): ChannelsDraft {
  return {
    allowDineIn: row.allowDineIn,
    allowTakeaway: row.allowTakeaway,
    allowDelivery: row.allowDelivery,
    deliveryFeeTaka: poisaToInputValue(row.deliveryFeePoisa),
    autoConfirmOrders: row.autoConfirmOrders,
  };
}

export function SettingsChannelsForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, channelsFromRow);

  const symbol = row.currencySymbol || "৳";
  const deliveryPoisa = takaField(draft.deliveryFeeTaka);
  const problems: string[] = [];
  if (deliveryPoisa === null) {
    problems.push("The delivery charge must be an amount in taka, e.g. 60. Leave it as 0 for no charge.");
  }
  if (!draft.allowDineIn && !draft.allowTakeaway && !draft.allowDelivery) {
    problems.push("Switch off at most two channels: with none left, no guest can order anything at all.");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (deliveryPoisa === null || problems.length > 0) return;
    const trimmed = draft.deliveryFeeTaka.trim();
    const overrides: Partial<SettingsWire> = {
      allowDineIn: draft.allowDineIn,
      allowTakeaway: draft.allowTakeaway,
      allowDelivery: draft.allowDelivery,
      // Taka exactly as typed — the server converts. Never multiplied here.
      deliveryFeePoisa: trimmed === "" ? "0" : trimmed,
      autoConfirmOrders: draft.autoConfirmOrders,
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice(
      `Saved. Guests can now order by: ${
        [next.allowDineIn ? "dine-in" : null, next.allowTakeaway ? "takeaway" : null, next.allowDelivery ? "delivery" : null]
          .filter((value): value is string => value !== null)
          .join(", ") || "nothing — every channel is switched off"
      }, with delivery charged ${formatPoisa(next.deliveryFeePoisa, { symbol: next.currencySymbol || symbol })}${
        next.autoConfirmOrders ? " and website orders confirming themselves on arrival" : ""
      }.`,
    );
  }

  return (
    <Panel title="Ordering channels" description="How a guest may order, and what it costs them.">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-3">
          <ToggleField
            id="set-dine-in"
            label="Dine-in at a table"
            checked={draft.allowDineIn}
            onChange={(value) => update({ allowDineIn: value })}
            hint="Switching this off removes ordering from the QR page a seated guest scans."
          />
          <ToggleField
            id="set-takeaway"
            label="Takeaway collection"
            checked={draft.allowTakeaway}
            onChange={(value) => update({ allowTakeaway: value })}
            hint="Switching this off removes collection from the guest's checkout."
          />
          <ToggleField
            id="set-delivery"
            label="Delivery"
            checked={draft.allowDelivery}
            onChange={(value) => update({ allowDelivery: value })}
            hint="Switching this off removes it from the guest's checkout; a delivery order already in the kitchen is unaffected."
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField
            id="set-delivery-fee"
            label={<>Delivery charge <span className="muted font-normal">(taka)</span></>}
            value={draft.deliveryFeeTaka}
            invalid={deliveryPoisa === null}
            onChange={(value) => update({ deliveryFeeTaka: value })}
            resultLabel={
              deliveryPoisa === null
                ? "Type the taka figure, e.g. 60."
                : <>Saves as <span className="price">{formatPoisa(deliveryPoisa, { symbol })}</span> per delivery order.</>
            }
          />
          <div className="space-y-2">
            <p className="label">Order approval</p>
            <ToggleField
              id="set-auto-confirm"
              label="Confirm website orders by themselves"
              checked={draft.autoConfirmOrders}
              onChange={(value) => update({ autoConfirmOrders: value })}
              hint="Off means a manager or the counter accepts each order before the kitchen sees it."
            />
          </div>
        </div>
        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save ordering channels"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}

type ReservationsDraft = {
  reservationSlotMinutes: string;
  reservationDurationMinutes: string;
  reservationBufferMinutes: string;
  reservationMaxDaysAhead: string;
  reservationCutoffMinutes: string;
  reservationDepositTaka: string;
  requirePolicyAcceptance: boolean;
};

function reservationsFromRow(row: SettingsRow): ReservationsDraft {
  return {
    reservationSlotMinutes: String(row.reservationSlotMinutes),
    reservationDurationMinutes: String(row.reservationDurationMinutes),
    reservationBufferMinutes: String(row.reservationBufferMinutes),
    reservationMaxDaysAhead: String(row.reservationMaxDaysAhead),
    reservationCutoffMinutes: String(row.reservationCutoffMinutes),
    reservationDepositTaka: poisaToInputValue(row.reservationDepositPoisa),
    requirePolicyAcceptance: row.requirePolicyAcceptance,
  };
}

export function SettingsReservationsForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, reservationsFromRow);

  const symbol = row.currencySymbol || "৳";
  const slot = intInRange(draft.reservationSlotMinutes, 5, 180);
  const duration = intInRange(draft.reservationDurationMinutes, 15, 480);
  const buffer = intInRange(draft.reservationBufferMinutes, 0, 240);
  const daysAhead = intInRange(draft.reservationMaxDaysAhead, 1, 365);
  const cutoff = intInRange(draft.reservationCutoffMinutes, 0, 1440);
  const deposit = takaField(draft.reservationDepositTaka);

  const problems: string[] = [];
  if (slot === null) problems.push("The booking slot must be a whole number of minutes between 5 and 180.");
  if (duration === null) problems.push("The table hold must be a whole number of minutes between 15 and 480.");
  if (buffer === null) problems.push("The buffer must be a whole number of minutes between 0 and 240.");
  if (daysAhead === null) problems.push("How far ahead guests may book must be a whole number of days between 1 and 365.");
  if (cutoff === null) problems.push("The booking cutoff must be a whole number of minutes between 0 and 1440.");
  if (deposit === null) problems.push("The booking deposit must be an amount in taka, e.g. 500. Leave it as 0 for no deposit.");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      slot === null ||
      duration === null ||
      buffer === null ||
      daysAhead === null ||
      cutoff === null ||
      deposit === null ||
      problems.length > 0
    ) {
      return;
    }
    const trimmed = draft.reservationDepositTaka.trim();
    const overrides: Partial<SettingsWire> = {
      reservationSlotMinutes: slot,
      reservationDurationMinutes: duration,
      reservationBufferMinutes: buffer,
      reservationMaxDaysAhead: daysAhead,
      reservationCutoffMinutes: cutoff,
      // Taka exactly as typed — the server converts. Never multiplied here.
      reservationDepositPoisa: trimmed === "" ? "0" : trimmed,
      requirePolicyAcceptance: draft.requirePolicyAcceptance,
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice(
      `Saved. Bookings now open in ${slot}-minute steps, hold a table for ${duration} minutes, are taken up to ${daysAhead} days ahead and must be made at least ${cutoff} minutes before the meal; the deposit a guest is quoted is ${formatPoisa(
        next.reservationDepositPoisa,
        { symbol: next.currencySymbol || symbol },
      )}. Bookings already confirmed keep the terms they were quoted.`,
    );
  }

  return (
    <Panel title="Reservations" description="The booking grid a guest sees, and what it takes to hold a table.">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            id="set-slot"
            label="Slot length"
            unit="minutes"
            value={draft.reservationSlotMinutes}
            invalid={slot === null}
            hint="How far apart the offered times are. 5 to 180."
            onChange={(value) => update({ reservationSlotMinutes: value })}
          />
          <NumberField
            id="set-duration"
            label="Table held for"
            unit="minutes"
            value={draft.reservationDurationMinutes}
            invalid={duration === null}
            hint="A slot is offered only when the whole hold fits inside the opening hours. 15 to 480."
            onChange={(value) => update({ reservationDurationMinutes: value })}
          />
          <NumberField
            id="set-buffer"
            label="Turnover buffer"
            unit="minutes"
            value={draft.reservationBufferMinutes}
            invalid={buffer === null}
            hint="Time left between two bookings at one table. 0 to 240."
            onChange={(value) => update({ reservationBufferMinutes: value })}
          />
          <NumberField
            id="set-ahead"
            label="Bookable how far ahead"
            unit="days"
            value={draft.reservationMaxDaysAhead}
            invalid={daysAhead === null}
            hint="1 to 365."
            onChange={(value) => update({ reservationMaxDaysAhead: value })}
          />
          <NumberField
            id="set-cutoff"
            label="Cutoff before the booking"
            unit="minutes"
            value={draft.reservationCutoffMinutes}
            invalid={cutoff === null}
            hint="No slot is offered closer than this to now. 0 to 1440."
            onChange={(value) => update({ reservationCutoffMinutes: value })}
          />
          <MoneyField
            id="set-deposit"
            label={<>Booking deposit <span className="muted font-normal">(taka)</span></>}
            value={draft.reservationDepositTaka}
            invalid={deposit === null}
            onChange={(value) => update({ reservationDepositTaka: value })}
            resultLabel={
              deposit === null
                ? "Type the taka figure, e.g. 500."
                : <>A guest is quoted <span className="price">{formatPoisa(deposit, { symbol })}</span> before the table is held; 0 means no deposit.</>
            }
          />
        </div>
        <div className="mt-3">
          <ToggleField
            id="set-policy"
            label="Guests must accept the booking policy"
            checked={draft.requirePolicyAcceptance}
            onChange={(value) => update({ requirePolicyAcceptance: value })}
            hint="With this off, a booking is taken without the guest agreeing to the cancellation terms."
          />
        </div>
        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save reservation rules"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}
