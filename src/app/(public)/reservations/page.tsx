import Link from "next/link";
import { Suspense } from "react";
import { siteContext, orUnset } from "@/server/http/site";
import { ReservationForm } from "@/components/site/reservation-form";

async function ReservationsBody() {
  const site = await siteContext();

  return (
    <div className="shell max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Book a table</h1>
      <p className="mt-1 text-sm soft">
        {site.hours} · {site.open ? "we are open now" : "we are closed right now"}.{" "}
        {orUnset(site.info.phonePrimary, "No telephone number is recorded —")}
      </p>

      <div className="mt-6">
        <ReservationForm
          todayKey={site.todayKey}
          maxDaysAhead={site.booking.maxDaysAhead}
          durationMinutes={site.booking.durationMinutes}
          depositPoisa={site.booking.depositPoisa}
          requirePolicy={site.booking.requirePolicyAcceptance}
          symbol={site.money.currencySymbol}
        />
      </div>

      <p className="hint mt-8">
        Already asked for a table? Open the link we sent with your confirmation, or{" "}
        <Link href="/reserve/my" className="underline">
          look one up by its code
        </Link>
        .
      </p>
    </div>
  );
}

export default function ReservationsPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-3xl py-10">
          <span className="skeleton block h-9 w-44" />
          <span className="skeleton mt-6 block h-64" />
        </div>
      }
    >
      <ReservationsBody />
    </Suspense>
  );
}
