import Link from "next/link";
import { Suspense } from "react";
import { ReservationSection } from "@/components/site/reservation-section";

async function ConfirmBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <div className="shell max-w-2xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Your booking request</h1>
      <p className="mt-1 text-sm soft">
        Keep this page or the link we emailed — it is the only way to see or change this booking.
      </p>
      <div className="mt-6">
        {token ? (
          <ReservationSection token={token} />
        ) : (
          <p className="notice">
            This page needs the link from your confirmation.{" "}
            <Link href="/reserve/my" className="underline">
              Look a booking up
            </Link>{" "}
            if you have it.
          </p>
        )}
      </div>
    </div>
  );
}

function Fallback() {
  return (
    <div className="shell max-w-2xl py-10">
      <span className="skeleton block h-9 w-56" />
      <span className="skeleton mt-6 block h-48" />
    </div>
  );
}

export default function ReservationConfirmPage(props: PageProps<"/reserve/confirm">) {
  return (
    <Suspense fallback={<Fallback />}>
      <ConfirmBody searchParams={props.searchParams} />
    </Suspense>
  );
}
