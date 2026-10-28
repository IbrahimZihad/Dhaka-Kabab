"use client";

import { Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import { ToggleField } from "@/components/admin/settings-form";
import {
  currentPayload,
  normaliseProvider,
  parseRow,
  useTrackedDraft,
  type ProviderChoice,
  type SaveResponse,
  type SectionProps,
  type SettingsRow,
  type SettingsWire,
} from "@/components/admin/settings-form";

/**
 * Which gateway may take money from a guest, and what the server can actually
 * reach.
 *
 * Nothing on this screen handles a credential: the SSLCommerz store id and API
 * key live in the deployment environment (SSLCOMMERZ_STORE_ID, SSLCOMMERZ_API_KEY,
 * SSLCOMMERZ_MODE), never in this form. The validation file does accept a
 * `paymentStoreId` write, but this screen deliberately keeps no field for it: a
 * value that can move money should not be typed into a browser, sent through a
 * settings PATCH, or echoed back in a GET of the row. The screen reports
 * readiness — configured or missing — and never calls a payment "live" from a
 * flag alone.
 */

export type GatewayReadinessView = {
  configured: string;
  available: boolean;
  realCredentials: boolean;
  label: string;
  mode: "sandbox" | "live" | null;
  missing: string[];
};

type PaymentsDraft = {
  paymentProvider: ProviderChoice;
  enablePartialPayments: boolean;
};

function fromRow(row: SettingsRow): PaymentsDraft {
  return {
    paymentProvider: normaliseProvider(row.paymentProvider),
    enablePartialPayments: row.enablePartialPayments,
  };
}

export function SettingsPaymentsForm({
  row,
  gateway,
  callbackUrl,
  onSaved,
}: SectionProps & { gateway: GatewayReadinessView; callbackUrl: string }) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, fromRow);

  const switchingToReal = draft.paymentProvider === "sslcommerz" && !gateway.realCredentials;
  const problems: string[] = [];
  if (switchingToReal) {
    problems.push(
      `SSLCommerz is chosen but its credentials are not set on this server (${
        gateway.missing.filter((name) => name.startsWith("SSLCOMMERZ")).join(" and ") || "store id and API key"
      }). The server refuses a provider it cannot reach, so set those environment variables first — they are not entered on this screen.`,
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length > 0) return;
    const overrides: Partial<SettingsWire> = {
      paymentProvider: draft.paymentProvider,
      enablePartialPayments: draft.enablePartialPayments,
      // paymentStoreId is never sent: see the header comment.
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    const saved = normaliseProvider(next.paymentProvider);
    action.setNotice(
      saved === "simulated"
        ? "Saved. Online payment runs on the simulated gateway: it records development payments, not real money, and none of it belongs in the takings."
        : saved === "sslcommerz"
          ? "Saved. SSLCommerz is now the selected gateway. Whether a payment is received is decided by the bank's responses, not by this screen."
          : "Saved. No gateway is selected, so the server contacts none: every bill is settled at the counter, where staff record cash, card and mobile banking.",
    );
  }

  return (
    <Panel title="Payments" description="Which gateway may take money from a guest, and what this server can really reach.">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="settings-payment-provider">
              Online payment gateway
            </label>
            <select
              id="settings-payment-provider"
              className="select"
              value={draft.paymentProvider}
              onChange={(event) => update({ paymentProvider: normaliseProvider(event.target.value) })}
            >
              <option value="none">No online payment (counter only)</option>
              <option value="simulated">Simulated gateway (development)</option>
              <option value="sslcommerz">SSLCommerz (real bank)</option>
            </select>
            <p className="hint mt-1">
              Changing this does not move a payment already handed to the other gateway: those stay pending until that
              gateway reports back, so settle or void them first. The counter takes cash, card and mobile banking
              either way. The simulated gateway is a development stand-in and takes nothing unless the server also has
              ALLOW_SIMULATED_GATEWAY set, so a store that leaves no gateway chosen is a store paid at the counter.
            </p>
          </div>
          <div className="space-y-2">
            <p className="label">Splitting a payment</p>
            <ToggleField
              id="settings-partial-payments"
              label="Let a bill be paid in more than one instalment"
              checked={draft.enablePartialPayments}
              onChange={(value) => update({ enablePartialPayments: value })}
              hint="With this off, a payment must cover the whole outstanding total."
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line p-3 text-sm">
          <p className="label">What the server can reach right now</p>
          <p className="soft">
            Saved gateway: <strong>{gateway.label}</strong>{" "}
            {gateway.mode ? <span className="badge ml-1">{gateway.mode}</span> : null}
          </p>
          <p className="hint mt-1">
            {gateway.configured === "sslcommerz"
              ? gateway.available
                ? "SSLCommerz is selected and its credentials are present, so online payment is available to guests. Bank responses, not this screen, decide whether a payment is received."
                : "SSLCommerz is selected but its credentials are missing, so the server refuses every online payment."
              : gateway.configured === "simulated"
                ? "The simulated gateway is selected. It takes no real money: every payment through it is a development record marked as such on the bill, and none of it belongs in the takings."
                : "Online payment is switched off; guests pay at the counter."}
          </p>
          {gateway.missing.length > 0 ? (
            <p className="hint mt-2">
              Missing environment variables: {gateway.missing.join(", ")}. These are set where the site runs, never
              here.
            </p>
          ) : null}
          <p className="hint mt-2">
            The bank returns to <span className="soft break-all">{callbackUrl}</span>. That address comes from APP_URL
            in the deployment environment.
          </p>
        </div>

        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={problems}
          label="Save payment settings"
          onReset={reset}
          hint="This screen cannot show or change a store id or API key; a save here only moves the `paymentProvider` and `enablePartialPayments` fields."
        />
      </form>
    </Panel>
  );
}
