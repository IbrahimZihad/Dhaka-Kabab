import { Suspense } from "react";
import Link from "next/link";
import { TrackForm } from "@/components/site/track-form";

function TrackBody() {
  return (
    <div className="shell max-w-2xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Track an order</h1>
      <p className="mt-1 text-sm soft">
        Enter the code from your confirmation page. Only the order behind that code is shown — nobody can browse
        someone else&apos;s meal with a guess.
      </p>
      <div className="mt-6">
        <TrackForm />
      </div>
      <p className="hint mt-6">
        At a table in the restaurant?{" "}
        <Link href="/order" className="underline">
          Open your table instead
        </Link>{" "}
        — it lists every order for the visit.
      </p>
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-2xl py-10">
          <span className="skeleton block h-9 w-48" />
        </div>
      }
    >
      <TrackBody />
    </Suspense>
  );
}
