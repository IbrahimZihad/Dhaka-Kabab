import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppError } from "@/lib/errors";
import { getOrderByPublicToken } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { guestOrder } from "@/server/http/guest-view";
import { LiveOrder } from "@/components/site/live-order";
import { TrackForm } from "@/components/site/track-form";

async function TrackBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let order;
  try {
    const [found, settings] = await Promise.all([getOrderByPublicToken(token), getSettings()]);
    order = guestOrder(found, settings.currencySymbol, settings.timezone);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="shell max-w-2xl py-10">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/track" className="hover:text-brand">
          Track an order
        </Link>
        <span className="mx-2">/</span>
        <span>{order.orderNumber}</span>
      </nav>
      <div className="mt-4">
        <LiveOrder token={token} initial={order} />
      </div>
      <div className="mt-8">
        <TrackForm />
      </div>
    </div>
  );
}

export default function TrackOrderPage(props: PageProps<"/track/[token]">) {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-2xl py-10">
          <span className="skeleton block h-9 w-48" />
          <span className="skeleton mt-4 block h-64" />
        </div>
      }
    >
      <TrackBody params={props.params} />
    </Suspense>
  );
}
