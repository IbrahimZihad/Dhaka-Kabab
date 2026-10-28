import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { formatPoisa } from "@/lib/money";
import { prisma } from "@/lib/db";
import { getCurrentUser, isStaffRole } from "@/lib/auth/session";
import { myOrderHistory, myReservations } from "@/server/services/customer.service";
import { getSettings } from "@/server/services/settings.service";
import { ProfileForm, PasswordChangeForm } from "@/components/site/profile-form";
import { SignOutButton } from "@/components/site/sign-out-button";

const ORDER_STATUS: Record<string, string> = {
  PENDING: "waiting",
  CONFIRMED: "confirmed",
  PREPARING: "cooking",
  READY: "ready",
  SERVED: "served",
  COMPLETED: "finished",
  CANCELLED: "cancelled",
};

async function AccountBody() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (isStaffRole(user.role)) redirect("/admin");

  const [profile, orders, reservations, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, email: true, phone: true, address: true },
    }),
    myOrderHistory(user.id, 10),
    myReservations(user.id, 10),
    getSettings(),
  ]);
  const symbol = settings.currencySymbol;

  return (
    <div className="shell max-w-4xl py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your account</h1>
          <p className="mt-1 text-sm soft">
            {profile.name} · {profile.email}
          </p>
        </div>
        <SignOutButton />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="space-y-6">
          <h2 className="text-lg font-bold">Details</h2>
          <ProfileForm initial={{ name: profile.name, phone: profile.phone ?? "", address: profile.address ?? "" }} />
          <h2 className="pt-2 text-lg font-bold">Password</h2>
          <PasswordChangeForm />
        </section>

        <section className="space-y-6">
          <div>
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">Recent orders</h2>
              <Link href="/menu" className="btn btn-ghost btn-sm">
                Order again
              </Link>
            </div>
            {orders.length === 0 ? (
              <p className="notice mt-3">
                Nothing yet. Orders placed as a guest from a table code do not appear here — sign in before ordering to
                keep them together.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {orders.map((order) => (
                  <li key={order.id} className="card p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/track/${order.publicToken}`} className="font-semibold hover:text-brand">
                        {order.orderNumber}
                      </Link>
                      <span className="hint">{new Date(order.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="hint mt-1">
                      {order.items.map((item) => `${item.quantity}× ${item.nameSnapshot}`).join(", ") || "no dishes recorded"}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="badge">{ORDER_STATUS[order.status] ?? order.status.toLowerCase()}</span>
                      <span className="price">{formatPoisa(order.totalPoisa, { symbol })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-lg font-bold">Recent bookings</h2>
            {reservations.length === 0 ? (
              <p className="notice mt-3">
                No bookings on this account.{" "}
                <Link href="/reservations" className="underline">
                  Book a table
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {reservations.map((reservation) => (
                  <li key={reservation.id} className="card flex items-center justify-between gap-3 p-4">
                    <span>
                      <Link href={`/reserve/${reservation.publicToken}`} className="font-semibold hover:text-brand">
                        {reservation.code}
                      </Link>
                      <span className="hint block">
                        {new Date(reservation.startsAt).toLocaleString()} · {reservation.partySize} guest
                        {reservation.partySize === 1 ? "" : "s"}
                        {reservation.tables.length ? ` · table ${reservation.tables.map((t) => t.table.label).join(", ")}` : ""}
                      </span>
                    </span>
                    <span className={`badge ${reservation.status === "CANCELLED" ? "badge-closed" : "badge-open"}`}>
                      {reservation.status.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-4xl py-10">
          <span className="skeleton block h-9 w-44" />
          <span className="skeleton mt-6 block h-64" />
        </div>
      }
    >
      <AccountBody />
    </Suspense>
  );
}
