import { Suspense } from "react";
import { siteContext } from "@/server/http/site";
import { CheckoutForm } from "@/components/site/checkout-form";
import { CartSummary } from "@/components/site/cart-summary";

async function CheckoutBody() {
  const site = await siteContext();
  return (
    <div className="shell grid max-w-5xl gap-8 py-10 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Place your order</h1>
        <p className="mt-1 text-sm soft">
          Nothing is charged here. The kitchen receives the dishes; payment happens at the counter, or online from your
          table once the bill is drawn up.
        </p>
        <div className="mt-6">
          <CheckoutForm
            allowTakeaway={site.info.allowTakeaway}
            allowDelivery={site.info.allowDelivery}
            deliveryFeePoisa={site.info.deliveryFeePoisa}
            currencySymbol={site.money.currencySymbol}
          />
        </div>
      </div>
      <aside>
        <CartSummary symbol={site.money.currencySymbol} />
      </aside>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="shell py-10">
          <span className="skeleton block h-9 w-56" />
          <span className="skeleton mt-6 block h-64" />
        </div>
      }
    >
      <CheckoutBody />
    </Suspense>
  );
}
