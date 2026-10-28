import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa, poisaToInputValue } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import {
  BILL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_RECORD_LABELS,
} from "@/lib/staff-format";
import { getSettings } from "@/server/services/settings.service";
import { getBillById } from "@/server/services/billing.service";
import { listPayments } from "@/server/services/payment.service";
import { providerReadiness } from "@/server/services/providers";
import { orUnset } from "@/server/http/site";
import { AdminTable, Details, EmptyState, Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { BillActions, BillVoidForm } from "@/components/admin/bill-actions";
import { BillPaymentForm } from "@/components/admin/bill-payment-form";
import { BillGatewayPaymentForm } from "@/components/admin/bill-gateway-payment-form";
import { BillRefundForm } from "@/components/admin/bill-refund-form";
import { BillReceipt } from "@/components/admin/bill-receipt";
import { PaymentStatusCheck } from "@/components/admin/payment-status-check";

async function BillDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;

  if (!roleHasPermission(user.role, "bill:view")) {
    return (
      <Panel title="This bill is not on your screen">
        <p className="hint">Takings are read by the roles that handle money. Ask a manager or the counter staff.</p>
      </Panel>
    );
  }

  const canRecord = roleHasPermission(user.role, "payment:record");
  const canRefund = roleHasPermission(user.role, "payment:refund");
  const canManage = roleHasPermission(user.role, "bill:manage");
  const canVoid = roleHasPermission(user.role, "bill:void");
  const canSeePayments = roleHasPermission(user.role, "payment:view");

  const settings = await getSettings();
  const symbol = settings.currencySymbol;
  const timeZone = settings.timezone;

  let loadFailure: string | null = null;
  let bill: Awaited<ReturnType<typeof getBillById>> | null = null;
  let paymentRows: Awaited<ReturnType<typeof listPayments>>["payments"] = [];
  let gateway: Awaited<ReturnType<typeof providerReadiness>> | null = null;

  try {
    const [loaded, payments, readiness] = await Promise.all([
      getBillById(id),
      canSeePayments ? listPayments({ billId: id }, { skip: 0, take: 100 }) : Promise.resolve(null),
      canRecord ? providerReadiness() : Promise.resolve(null),
    ]);
    bill = loaded;
    paymentRows = payments?.payments.slice().reverse() ?? [];
    gateway = readiness;
  } catch (error) {
    loadFailure = error instanceof Error ? error.message : "This bill could not be read.";
  }

  if (!bill) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Panel title="Bill not available">
          <Note kind="error">{loadFailure ?? "This bill could not be read."}</Note>
        </Panel>
      </div>
    );
  }

  const outstandingPoisa = Math.max(0, bill.totalPoisa - bill.paidPoisa);
  const chargesPoisa = bill.serviceChargePoisa + bill.vatPoisa;
  const overpaidPoisa = Math.max(0, bill.paidPoisa - bill.totalPoisa);
  const verifiedPayments = paymentRows.filter((payment) => payment.status === "SUCCEEDED");
  const pendingPayments = paymentRows.filter((payment) => payment.status === "PENDING");
  const demoMoneyHeld = paymentRows.some((payment) => payment.isDemo);
  const localised = (value: Date | null) => (value ? formatInZone(value, timeZone, { year: undefined }) : null);

  const refundable = verifiedPayments
    .map((payment) => {
      const alreadyGivenBack = payment.refunds
        .filter((refund) => refund.status !== "FAILED")
        .reduce((sum, refund) => sum + refund.amountPoisa, 0);
      const refundablePoisa = Math.max(0, payment.amountPoisa - alreadyGivenBack);
      return {
        id: payment.id,
        reference: payment.reference,
        methodLabel: PAYMENT_METHOD_LABELS[payment.method],
        amountLabel: formatPoisa(payment.amountPoisa, { symbol }),
        refundableInputValue: poisaToInputValue(refundablePoisa),
        refundableLabel: formatPoisa(refundablePoisa, { symbol }),
        isDemo: payment.isDemo,
      };
    })
    .filter((entry) => entry.refundableInputValue !== "0.00");

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="font-mono">{bill.number}</span>
          </h1>
          <p className="hint mt-1">
            {bill.session
              ? `Table ${bill.session.table.label} · session ${bill.session.code}`
              : bill.order
                ? `Bill raised against order ${bill.order.orderNumber}`
                : "Not attached to a table"}
            {bill.orders.length > 0
              ? ` · ${bill.orders.length} order(s): ${bill.orders.map((link) => link.order.orderNumber).join(", ")}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={BILL_STATUS_LABELS[bill.status]} />
          {bill.isDemo ? <span className="badge badge-closed">Simulated bill</span> : null}
        </div>
      </div>

      {bill.status === "VOIDED" ? (
        <Note kind="error">
          This bill was voided{bill.voidedAt ? ` on ${localised(bill.voidedAt)}` : ""}. Voiding is a recorded action, not
          a deletion — the lines and the reason stay on the ledger. Reason given: {orUnset(bill.voidReason)}.
        </Note>
      ) : null}

      {bill.status === "FINALIZED" && outstandingPoisa > 0 ? (
        <Note>
          Finalized on {localised(bill.finalizedAt) ?? orUnset(null)} at {formatPoisa(bill.totalPoisa, { symbol })}. A
          finalized bill is an issued document: its lines cannot be edited, only paid, refunded or voided.
        </Note>
      ) : null}

      <Panel title="Money" description="Everything below is the bill's own stored figures, in the restaurant's currency.">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Money label="Subtotal" value={formatPoisa(bill.subtotalPoisa, { symbol })} />
          <Money label="Discount" value={bill.discountPoisa > 0 ? `−${formatPoisa(bill.discountPoisa, { symbol })}` : "None taken"} />
          <Money label="Service charge" value={formatPoisa(bill.serviceChargePoisa, { symbol })} />
          <Money label="VAT" value={formatPoisa(bill.vatPoisa, { symbol })} />
          <Money label="Charges together" value={formatPoisa(chargesPoisa, { symbol })} />
          <Money label="Total owed" value={formatPoisa(bill.totalPoisa, { symbol })} strong />
          <Money label="Received" value={formatPoisa(bill.paidPoisa, { symbol })} />
          <Money
            label="Outstanding"
            value={outstandingPoisa > 0 ? formatPoisa(outstandingPoisa, { symbol }) : "Nothing outstanding"}
            strong={outstandingPoisa > 0}
          />
        </dl>
        {overpaidPoisa > 0 ? (
          <Note kind="error">
            {formatPoisa(overpaidPoisa, { symbol })} was taken beyond this bill. It is owed back to the guest and should
            be refunded rather than left on the till.
          </Note>
        ) : null}
        {bill.refundedPoisa > 0 ? (
          <p className="hint mt-3">
            {formatPoisa(bill.refundedPoisa, { symbol })} has been given back against verified refunds on this bill.
          </p>
        ) : null}
        {demoMoneyHeld ? (
          <p className="notice mt-3">
            A payment recorded here came from the simulated gateway. It is flagged on every line below and must not be
            read as takings.
          </p>
        ) : null}

        <div className="mt-4">
          <Details
            rows={[
              { label: "Raised", value: localised(bill.createdAt) ?? orUnset(null) },
              {
                label: "Finalized",
                value: localised(bill.finalizedAt) ?? (bill.status === "OPEN" ? "Not finalized yet" : orUnset(null)),
              },
              { label: "Settled", value: localised(bill.settledAt) ?? "Not settled" },
              { label: "Currency", value: settings.currencyCode },
            ]}
          />
        </div>
      </Panel>

      <Panel
        title="Lines"
        description={
          bill.status === "OPEN"
            ? "An open bill mirrors the table's orders, so a line can still arrive or drop out until it is finalized."
            : "Copied when this bill was issued. These lines are fixed; editing them is not offered."
        }
      >
        {bill.items.length === 0 ? (
          <EmptyState title="No lines on this bill yet">
            Nothing has been ordered against it, or the orders were all cancelled while the bill was still open.
          </EmptyState>
        ) : (
          <AdminTable head={["Item", "Choices on the line", "From order", "Quantity", "Each", "Line total"]}>
            {bill.items.map((item) => {
              const choices = Array.isArray(item.optionsSnapshot)
                ? (item.optionsSnapshot as { optionName?: string; groupName?: string }[])
                : [];
              const note = choices
                .map((option) => option.optionName ?? option.groupName ?? "")
                .filter(Boolean)
                .join(", ");
              return (
                <tr key={item.id} className="border-b border-line">
                  <td className="px-3 py-2 font-semibold">{item.description}</td>
                  <td className="px-3 py-2 muted">{note ? note : orUnset(null)}</td>
                  <td className="px-3 py-2 font-mono muted">{item.orderNumber ?? orUnset(null)}</td>
                  <td className="px-3 py-2 tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPoisa(item.unitPricePoisa, { symbol })}</td>
                  <td className="px-3 py-2 price">{formatPoisa(item.lineTotalPoisa, { symbol })}</td>
                </tr>
              );
            })}
          </AdminTable>
        )}
      </Panel>

      <Panel
        title="Payments and refunds"
        description="Only a verified payment counts as received. A hand-off to the bank does not."
      >
        {!canSeePayments ? (
          <p className="hint">Your role may see the bill total but not the payments behind it.</p>
        ) : paymentRows.length === 0 ? (
          <EmptyState title="No payment recorded against this bill">
            {outstandingPoisa > 0
              ? `Nothing has come in yet. ${formatPoisa(outstandingPoisa, { symbol })} is outstanding.`
              : "This bill carries no charge, so no payment was expected."}
          </EmptyState>
        ) : (
          <>
            <AdminTable head={["Reference", "Method", "Amount", "State", "When", "Taken by", "Given back"]}>
              {paymentRows.map((payment) => {
                const givenBack = payment.refunds
                  .filter((refund) => refund.status !== "FAILED")
                  .reduce((sum, refund) => sum + refund.amountPoisa, 0);
                return (
                  <tr key={payment.id} className="border-b border-line">
                    <td className="px-3 py-2 font-mono">
                      {payment.reference}
                      {payment.isDemo ? <span className="badge badge-closed ml-2">Simulated</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                      <span className="hint block">{orUnset(payment.provider)}</span>
                    </td>
                    <td className="px-3 py-2 price">{formatPoisa(payment.amountPoisa, { symbol })}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={PAYMENT_RECORD_LABELS[payment.status]} />
                      {payment.failureReason ? <span className="hint block">{payment.failureReason}</span> : null}
                      {payment.status === "PENDING" ? (
                        <div className="mt-1">
                          <PaymentStatusCheck reference={payment.reference} timeZone={timeZone} />
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 muted">
                      {localised(payment.verifiedAt ?? payment.createdAt) ?? orUnset(null)}
                      <span className="hint block">started {localised(payment.createdAt) ?? orUnset(null)}</span>
                    </td>
                    <td className="px-3 py-2">
                      {payment.provider === "counter"
                        ? orUnset(payment.takenBy?.name ?? null)
                        : payment.takenBy
                          ? `${payment.takenBy.name} at the counter`
                          : orUnset("the bank")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {givenBack > 0 ? (
                        <span className="text-danger">{formatPoisa(givenBack, { symbol })}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </AdminTable>

            {pendingPayments.length > 0 ? (
              <p className="notice mt-3">
                {pendingPayments.length} online payment(s) here are still waiting on the bank. Until its verified
                notification arrives they are not received money, and the outstanding figure above does not change.
              </p>
            ) : null}

            {bill.refunds.length > 0 ? (
              <div className="mt-4">
                <p className="label">Refunds recorded</p>
                <AdminTable head={["Refund", "Amount", "Reason", "State", "Recorded"]}>
                  {bill.refunds.map((refund) => (
                    <tr key={refund.id} className="border-b border-line">
                      <td className="px-3 py-2 font-mono">{refund.number}</td>
                      <td className="px-3 py-2 price">{formatPoisa(refund.amountPoisa, { symbol })}</td>
                      <td className="px-3 py-2">{orUnset(refund.reason)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={
                            refund.status === "COMPLETED"
                              ? "Given back"
                              : refund.status === "PENDING"
                                ? "Waiting on the gateway"
                                : "Failed"
                          }
                        />
                      </td>
                      <td className="px-3 py-2 muted">{localised(refund.processedAt ?? refund.createdAt) ?? orUnset(null)}</td>
                    </tr>
                  ))}
                </AdminTable>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Take money at the counter" description="Cash, card or mobile banking handed over here.">
          {!canRecord ? (
            <p className="hint">Recording a payment needs the cashier role or above. Your role can read, not receive.</p>
          ) : bill.status === "VOIDED" ? (
            <p className="hint">A voided bill cannot accept payments.</p>
          ) : outstandingPoisa === 0 ? (
            <p className="hint">
              Nothing is outstanding on this bill, so there is nothing to take. If the guest handed over more than the
              total, refund the difference instead.
            </p>
          ) : (
            <BillPaymentForm
              billId={bill.id}
              outstandingInputValue={poisaToInputValue(outstandingPoisa)}
              outstandingLabel={formatPoisa(outstandingPoisa, { symbol })}
              currencySymbol={symbol}
            />
          )}
        </Panel>

        <Panel title="Pay online from the counter" description="The guest pays the bank; this till only starts the hand-off.">
          {!canRecord ? (
            <p className="hint">Only a role that may record payments can start a bank hand-off.</p>
          ) : bill.status !== "FINALIZED" ? (
            <p className="hint">
              {bill.status === "OPEN"
                ? "This bill is still open, so the total can grow underneath the guest. Finalize it before sending money to the bank."
                : "This bill needs no online hand-off."}
            </p>
          ) : outstandingPoisa === 0 ? (
            <p className="hint">Nothing is outstanding, so there is nothing to send to the bank.</p>
          ) : (
            <BillGatewayPaymentForm
              billId={bill.id}
              outstandingLabel={formatPoisa(outstandingPoisa, { symbol })}
              currencySymbol={symbol}
              timeZone={timeZone}
              gatewayReady={gateway?.available ?? false}
              gatewayMessage={
                gateway && !gateway.available
                  ? gateway.missing.length > 0
                    ? `Online payment is unavailable. Still needed: ${gateway.missing.join(", ")}.`
                    : `Online payment is unavailable (${gateway.label}).`
                  : "Online payment is not configured."
              }
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Refund money already received"
        description="A refund gives back part of a verified payment. It is recorded against that payment and never removes it."
      >
        {!canRefund ? (
          <p className="hint">
            Refunds need the manager-level permission held by owners and managers. Ask one of them to record it.
          </p>
        ) : (
          <BillRefundForm payments={refundable} currencySymbol={symbol} />
        )}
      </Panel>

      <Panel title="This bill" description="Refresh while it is open, then finalize it once the table has finished.">
        <div className="space-y-4">
          <BillActions
            billId={bill.id}
            billNumber={bill.number}
            status={bill.status}
            canManage={canManage}
            currencySymbol={symbol}
          />
          {canVoid ? (
            <BillVoidForm
              billId={bill.id}
              billNumber={bill.number}
              status={bill.status}
              paymentsHeld={verifiedPayments.length > 0}
            />
          ) : null}
        </div>
      </Panel>

      <Panel title="Receipt" description="The figures the restaurant holds for this bill, straight from the receipt route.">
        <BillReceipt billId={bill.id} timeZone={timeZone} />
      </Panel>

      {bill.orders.length > 0 ? (
        <p className="hint">
          The orders behind this bill are on the{" "}
          <Link
            href={`/admin/orders?search=${encodeURIComponent(bill.orders[0].order.orderNumber)}`}
            className="underline"
          >
            orders screen
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function Money({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={strong ? "price text-lg" : "soft"}>{value}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/bills" className="btn btn-ghost btn-sm self-start">
      Back to bills
    </Link>
  );
}

export default function AdminBillPage(props: PageProps<"/admin/bills/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <span className="skeleton block h-8 w-40" />
          <span className="skeleton block h-12 w-64" />
          <span className="skeleton block h-48" />
          <span className="skeleton block h-64" />
        </div>
      }
    >
      <BillDetail params={props.params} />
    </Suspense>
  );
}
