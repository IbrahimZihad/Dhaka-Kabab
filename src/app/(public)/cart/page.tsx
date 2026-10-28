import Link from "next/link";
import { Suspense } from "react";
import { siteContext } from "@/server/http/site";
import { CartView } from "@/components/site/cart-view";

async function CartBody() {
  const site = await siteContext();
  return (
    <div className="shell max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Your order</h1>
      <p className="mt-1 text-sm soft">
        This list is saved on this device only. It is not an order until you place it, and it is not a bill until the
        restaurant prices it.
      </p>
      <div className="mt-6">
        <CartView symbol={site.money.currencySymbol} />
      </div>
      <p className="mt-8">
        <Link href="/menu" className="btn btn-ghost btn-sm">
          Back to the menu
        </Link>
      </p>
    </div>
  );
}

export default function CartPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-3xl py-10">
          <span className="skeleton block h-9 w-40" />
          <span className="skeleton mt-6 block h-40" />
        </div>
      }
    >
      <CartBody />
    </Suspense>
  );
}
