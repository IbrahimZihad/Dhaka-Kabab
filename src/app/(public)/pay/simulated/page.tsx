import { Suspense } from "react";
import Link from "next/link";
import { env } from "@/lib/env";
import { simulatedPaymentView } from "@/server/services/payment.service";
import { SimulatedPaymentForm } from "@/components/site/simulated-payment-form";

/**
 * The `next` target arrives in a URL a guest could have typed, so it is resolved
 * against this site and only ever leaves the browser on our own origin. Anything
 * else falls back to the home page rather than becoming an open redirect.
 */
function safeNext(raw: string | string[] | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  try {
    const url = new URL(raw, env.appUrl);
    if (url.origin !== new URL(env.appUrl).origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function SimulatedBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reference = typeof params.ref === "string" ? params.ref : "";
  const next = safeNext(params.next);
  const view = reference ? await simulatedPaymentView(reference) : null;

  return (
    <div className="shell max-w-2xl py-10">
      <p className="badge badge-brand">Development gateway</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Simulated payment</h1>
      <p className="mt-2 text-sm soft">
        No payment provider is configured for this installation, so online payments run through this stand-in. It
        exercises the same recording, verification and receipt path as a real gateway, and marks everything it produces
        as simulated.
      </p>

      {!view ? (
        <p className="notice notice-error mt-6">
          {reference
            ? "This payment reference is unknown, already settled, or belongs to a real gateway. Nothing was changed."
            : "This page needs a payment reference. Start an online payment from your table or from the counter."}
        </p>
      ) : view.status !== "PENDING" ? (
        <p className="notice mt-6">
          Payment {view.reference} is already {view.status.toLowerCase()} — the bill has not been touched again.{" "}
          <Link href={next} className="underline">
            Continue
          </Link>
        </p>
      ) : (
        <div className="mt-6">
          <dl className="card mb-4 grid grid-cols-2 gap-3 p-4 text-sm">
            <div>
              <dt className="label">Bill</dt>
              <dd>{view.billNumber ?? "not linked"}</dd>
            </div>
            <div>
              <dt className="label">Table</dt>
              <dd>{view.tableLabel ?? "counter"}</dd>
            </div>
            <div>
              <dt className="label">Bill total</dt>
              <dd>{view.billTotal ?? "—"}</dd>
            </div>
            <div>
              <dt className="label">Still outstanding</dt>
              <dd>{view.billOutstanding ?? "—"}</dd>
            </div>
          </dl>
          <SimulatedPaymentForm reference={view.reference} amount={view.amount} next={next} />
        </div>
      )}
    </div>
  );
}

export default function SimulatedPaymentPage(props: PageProps<"/pay/simulated">) {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-2xl py-10">
          <span className="skeleton block h-9 w-56" />
          <span className="skeleton mt-6 block h-40" />
        </div>
      }
    >
      <SimulatedBody searchParams={props.searchParams} />
    </Suspense>
  );
}
