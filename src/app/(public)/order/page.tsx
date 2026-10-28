import { Suspense } from "react";
import Link from "next/link";
import { siteContext } from "@/server/http/site";
import { TableOrder } from "@/components/site/table-order";

async function OrderBody() {
  const site = await siteContext();
  return (
    <div className="shell max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Ordering at your table</h1>
      <p className="mt-1 text-sm soft">
        {site.info.name} — {site.open ? "open now" : "closed right now, but a table already open can keep ordering"}.
      </p>
      <div className="mt-6">
        <TableOrder symbol={site.money.currencySymbol} />
      </div>
      <p className="hint mt-8">
        Problems with the code? Ask a member of staff — they can open a fresh one for the table.{" "}
        <Link href="/track" className="underline">
          Track an order
        </Link>{" "}
        if you have an order number instead.
      </p>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-3xl py-10">
          <span className="skeleton block h-9 w-64" />
          <span className="skeleton mt-6 block h-48" />
        </div>
      }
    >
      <OrderBody />
    </Suspense>
  );
}
