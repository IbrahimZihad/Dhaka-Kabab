"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { PaymentStatusCheck } from "@/components/admin/payment-status-check";
import { formatPoisa } from "@/lib/money";

type Handoff = {
  paymentId: string;
  reference: string;
  actionUrl: string;
  httpMethod: "POST" | "GET";
  form?: Record<string, string>;
  notice?: string | null;
  isDemo: boolean;
  providerLabel: string;
  amountPoisa: number;
  currency: string;
};

/**
 * A counter-initiated online payment. The restaurant's own staff start the
 * hand-off, but this screen cannot finish it: initiating only writes a PENDING
 * record and returns the bank's address. The verified server-to-server callback
 * is what turns it into money, so every figure here stays labelled as waiting
 * until a check says otherwise.
 */
export function BillGatewayPaymentForm({
  billId,
  outstandingLabel,
  currencySymbol,
  timeZone,
  gatewayReady,
  gatewayMessage,
}: {
  billId: string;
  outstandingLabel: string;
  currencySymbol: string;
  timeZone: string;
  gatewayReady: boolean;
  gatewayMessage: string;
}) {
  const router = useRouter();
  const action = useAdminAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  const ready = name.trim().length >= 2 && email.trim().length > 0 && phone.trim().length >= 11;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await action.run<Handoff>("POST", "/api/payments/gateway/initiate", {
      billId,
      method: "ONLINE_GATEWAY",
      // Bring the browser back to this bill, never to the bare payments screen:
      // the return hop proves nothing, but it should at least land somewhere real.
      returnUrl: `${window.location.origin}/admin/bills/${billId}`,
      customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
    });
    if (!result) return;
    setHandoff(result);
    action.setNotice(null);
    router.refresh();
  }

  if (!gatewayReady) {
    return <p className="notice">{gatewayMessage} Please take the money at the counter instead.</p>;
  }

  return (
    <div className="no-print space-y-4">
      <p className="hint">
        This sends the guest to the bank for the exact outstanding {outstandingLabel}. Handing the page over records a
        payment that is only waiting; it does not settle anything.
      </p>

      {!handoff ? (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="gateway-name">
                Payer&apos;s name
              </label>
              <input id="gateway-name" className="input" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="gateway-email">
                Payer&apos;s email
              </label>
              <input id="gateway-email" className="input" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="gateway-phone">
                Mobile number
              </label>
              <input id="gateway-phone" className="input" inputMode="tel" autoComplete="off" placeholder="01712345678" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
          </div>
          {action.error ? <p className="notice notice-error">{action.error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={action.busy || !ready}>
            {action.busy ? "Starting the hand-off…" : `Send ${outstandingLabel} to the bank`}
          </button>
          <p className="hint">
            The gateway forms insist on a name, an address for the number and an email. We do not invent them, so a
            bill with no payer details cannot be pushed online.
          </p>
        </form>
      ) : (
        <div className="space-y-3">
          {handoff.notice ? <p className="notice">{handoff.notice}</p> : null}
          <p className="notice notice-ok">
            Hand-off started. Payment reference <span className="font-mono">{handoff.reference}</span> for{" "}
            <span className="price">{formatPoisa(handoff.amountPoisa, { symbol: currencySymbol })}</span>{" "}
            {handoff.isDemo ? "on the simulated gateway — this is not real money" : `with ${handoff.providerLabel}`}.
          </p>
          <p className="notice">
            Waiting for the bank to confirm. Until its verified notification arrives, this bill has not been paid and
            the amount is still outstanding.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {handoff.httpMethod === "GET" ? (
              <a
                href={handoff.actionUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline btn-sm"
              >
                Open the payment page
              </a>
            ) : (
              <form action={handoff.actionUrl} method="POST" className="inline">
                {Object.entries(handoff.form ?? {}).map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} readOnly />
                ))}
                <button type="submit" className="btn btn-outline btn-sm">
                  Send the customer to the bank
                </button>
              </form>
            )}
            <PaymentStatusCheck reference={handoff.reference} timeZone={timeZone} />
          </div>
        </div>
      )}
    </div>
  );
}
