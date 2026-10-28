import Link from "next/link";
import { Suspense } from "react";
import { TrackForm } from "@/components/site/track-form";

function MyBody() {
  return (
    <div className="shell max-w-2xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Find your booking</h1>
      <p className="mt-1 text-sm soft">
        Paste the link we sent when you booked. The short code alone is not enough — it is only ever a label, and anyone
        who guessed one could otherwise read someone else&apos;s evening.
      </p>
      <div className="mt-6">
        <TrackForm
          basePath="/reserve"
          placeholder="Booking link, or the code at the end of it"
          button="Find my booking"
          help="That is not a booking link. Use the address we sent you, or ask staff to resend it."
        />
      </div>
      <p className="hint mt-6">
        Want a new table instead?{" "}
        <Link href="/reservations" className="underline">
          Book here
        </Link>
        .
      </p>
    </div>
  );
}

export default function ReserveLookupPage() {
  return (
    <Suspense fallback={<div className="shell max-w-2xl py-10"><span className="skeleton block h-9 w-52" /></div>}>
      <MyBody />
    </Suspense>
  );
}
