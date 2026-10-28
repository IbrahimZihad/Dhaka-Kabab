"use client";

import { Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import { bpsToPercentLabel, formatPoisa, parseMoneyInput } from "@/lib/money";
import { computeTotals } from "@/lib/billing-math";
import {
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
 * Charges. `serviceChargeBps` and `vatBps` are stored as basis points (1000 is
 * 10.00%), so the owner types a PERCENT and this panel multiplies by exactly 100
 * once, here, and nowhere else. The worked example runs the real
 * `computeTotals` from src/lib/billing-math.ts on a ৳400 basket — the same maths
 * that prices a live bill — so the figures below are what a guest will be
 * charged, not an approximation of it.
 */

type ChargesDraft = {
  serviceChargePercent: string;
  vatPercent: string;
  vatOnServiceCharge: boolean;
  roundingStepPoisa: number;
};

function fromRow(row: SettingsRow): ChargesDraft {
  return {
    serviceChargePercent: bpsToPercentLabel(row.serviceChargeBps),
    vatPercent: bpsToPercentLabel(row.vatBps),
    vatOnServiceCharge: row.vatOnServiceCharge,
    roundingStepPoisa: row.roundingStepPoisa,
  };
}

/** Percent as typed -> basis points. 10 -> 1000, 7.5 -> 750. Null when unusable. */
function percentToBps(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.]/g, "");
  if (cleaned === "") return null;
  const percent = Number(cleaned);
  if (!Number.isFinite(percent)) return null;
  const bps = Math.round(percent * 100);
  // The server accepts 0–5000 bps, i.e. 0–50 percent.
  if (bps < 0 || bps > 5000) return null;
  return bps;
}

const ROUNDING_OPTIONS = [
  { value: 1, label: "No rounding — every poisa counted" },
  { value: 10, label: "Nearest 0.10 taka" },
  { value: 100, label: "Nearest 1 taka" },
  { value: 500, label: "Nearest 5 taka" },
  { value: 1000, label: "Nearest 10 taka" },
];

export function SettingsChargesForm({ row, onSaved }: SectionProps) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, fromRow);

  const serviceChargeBps = percentToBps(draft.serviceChargePercent);
  const vatBps = percentToBps(draft.vatPercent);
  const roundingValid = ROUNDING_OPTIONS.some((option) => option.value === draft.roundingStepPoisa);
  const problems: string[] = [];
  if (serviceChargeBps === null) problems.push("The service charge must be a percent between 0 and 50, e.g. 10.");
  if (vatBps === null) problems.push("The VAT must be a percent between 0 and 50, e.g. 5.");
  if (!roundingValid) problems.push("Choose one of the listed rounding steps.");

  const symbol = row.currencySymbol || "৳";
  // The same computeTotals the till uses, on a plain ৳400 food basket.
  const example =
    serviceChargeBps !== null && vatBps !== null && roundingValid
      ? computeTotals({
          lines: [{ lineTotalPoisa: 40000 }],
          serviceChargeBps,
          vatBps,
          vatOnServiceCharge: draft.vatOnServiceCharge,
          roundingStepPoisa: draft.roundingStepPoisa,
        })
      : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (serviceChargeBps === null || vatBps === null || !roundingValid) return;
    const overrides: Partial<SettingsWire> = {
      serviceChargeBps,
      vatBps,
      vatOnServiceCharge: draft.vatOnServiceCharge,
      roundingStepPoisa: draft.roundingStepPoisa,
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
      `Saved. Bills raised from now on add ${bpsToPercentLabel(next.serviceChargeBps)}% service and ${bpsToPercentLabel(
        next.vatBps,
      )}% VAT${next.vatOnServiceCharge ? " (VAT on the service charge too)" : " (VAT on food only)"}. ` +
        "Bills already totalled keep the figures printed on them — this save does not re-price them, and a kitchen " +
        "ticket already in the fire does not change either.",
    );
  }

  const deliveryProbe = parseMoneyInput(currentPayload(row).deliveryFeePoisa);

  return (
    <Panel title="Charges and rounding" description="What the till adds on top of the food, for every new bill.">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="set-service-charge">
              Service charge (%) — stored as basis points
            </label>
            <input
              id="set-service-charge"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={draft.serviceChargePercent}
              aria-invalid={serviceChargeBps === null || undefined}
              onChange={(event) => update({ serviceChargePercent: event.target.value })}
            />
            <p className="hint mt-1">
              {serviceChargeBps === null ? (
                <span className="text-danger">Not a usable percent (0 to 50).</span>
              ) : (
                <>
                  Reads as <span className="price">{bpsToPercentLabel(serviceChargeBps)}%</span>. Sent to the server as{" "}
                  <strong>{serviceChargeBps} basis points</strong>, where 1000 is 10.00%.
                </>
              )}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="set-vat">
              VAT (%) — stored as basis points
            </label>
            <input
              id="set-vat"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={draft.vatPercent}
              aria-invalid={vatBps === null || undefined}
              onChange={(event) => update({ vatPercent: event.target.value })}
            />
            <p className="hint mt-1">
              {vatBps === null ? (
                <span className="text-danger">Not a usable percent (0 to 50).</span>
              ) : (
                <>
                  Reads as <span className="price">{bpsToPercentLabel(vatBps)}%</span>. Sent as{" "}
                  <strong>{vatBps} basis points</strong>, where 500 is 5.00%.
                </>
              )}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="set-rounding">
              Rounding step on a total
            </label>
            <select
              id="set-rounding"
              className="select"
              value={draft.roundingStepPoisa}
              onChange={(event) => update({ roundingStepPoisa: Number(event.target.value) })}
            >
              {ROUNDING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="hint mt-1">Bangladesh has no poisa coin, so most kitchens round to the nearest taka.</p>
          </div>
          <div className="space-y-2">
            <p className="label">How VAT is applied</p>
            <ToggleField
              id="set-vat-on-service"
              label="VAT also charged on the service charge"
              checked={draft.vatOnServiceCharge}
              onChange={(value) => update({ vatOnServiceCharge: value })}
              hint="Off: VAT applies to the food total only. On: it applies to the food plus the service charge."
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line p-3">
          <p className="label">Worked example — a ৳400 food basket, priced by the real billing maths</p>
          {example ? (
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex justify-between gap-3">
                <dt className="soft">Food subtotal</dt>
                <dd className="price">{formatPoisa(example.subtotalPoisa, { symbol })}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="soft">Service charge</dt>
                <dd className="price">{formatPoisa(example.serviceChargePoisa, { symbol })}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="soft">
                  VAT {draft.vatOnServiceCharge ? "(on food plus service)" : "(on food only)"}
                </dt>
                <dd className="price">{formatPoisa(example.vatPoisa, { symbol })}</dd>
              </div>
              {draft.roundingStepPoisa > 1 ? (
                <div className="flex justify-between gap-3">
                  <dt className="soft">Cash rounding</dt>
                  <dd className="price">
                    {example.roundingAdjustmentPoisa === 0
                      ? "none needed"
                      : `${example.roundingAdjustmentPoisa > 0 ? "+" : ""}${formatPoisa(example.roundingAdjustmentPoisa, { symbol })}`}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
                <dt>Total the guest pays</dt>
                <dd className="price">{formatPoisa(example.totalPoisa, { symbol })}</dd>
              </div>
            </dl>
          ) : (
            <p className="hint mt-1">Set both rates to usable percents to see the example.</p>
          )}
          <p className="hint mt-2">
            A delivery order would add the delivery charge from the ordering panel below (currently{" "}
            {deliveryProbe === null ? "unreadable" : formatPoisa(deliveryProbe, { symbol })}); dine-in and takeaway
            bills do not carry it.
          </p>
        </div>

        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save charges"
          onReset={reset}
          hint="A service charge or VAT raised here is charged to every guest from the next bill onward."
        />
      </form>
    </Panel>
  );
}
