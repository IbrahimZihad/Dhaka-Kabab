import { Suspense } from "react";
import { ReservationSection } from "@/components/site/reservation-section";

async function Body({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="shell max-w-2xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Your booking</h1>
      <div className="mt-6">
        <ReservationSection token={token} />
      </div>
    </div>
  );
}

export default function ReservationByTokenPage(props: PageProps<"/reserve/[token]">) {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-2xl py-10">
          <span className="skeleton block h-9 w-56" />
          <span className="skeleton mt-6 block h-48" />
        </div>
      }
    >
      <Body params={props.params} />
    </Suspense>
  );
}
