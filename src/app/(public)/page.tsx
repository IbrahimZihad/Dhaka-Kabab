import Link from "next/link";
import { Suspense } from "react";
import { getFeaturedItems } from "@/server/services/menu.service";
import { orUnset, siteContext } from "@/server/http/site";
import { MenuImage, Price } from "@/components/ui/menu-image";

async function HomeBody() {
  const [site, featured] = await Promise.all([siteContext(), getFeaturedItems(6)]);
  const { info } = site;

  return (
    <>
      <section className="border-b border-line bg-paper-raised">
        <div className="shell grid gap-8 py-12 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div>
            <p className="badge badge-brand">{site.open ? "Open now" : "Closed right now"}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink md:text-4xl">{info.name}</h1>
            <p className="mt-3 max-w-prose text-base soft">
              Charcoal-grilled kababs, rice and the usual accompaniments. Look the menu over here, book a table for a
              sit-down, or scan the code on the table in front of you and order from your phone.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/menu" className="btn btn-primary">
                See the menu
              </Link>
              <Link href="/reservations" className="btn btn-outline">
                Book a table
              </Link>
              <Link href="/track" className="btn btn-ghost">
                Track an order
              </Link>
            </div>
            <dl className="mt-8 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="label">Opening hours</dt>
                <dd className="soft">{site.hours}</dd>
              </div>
              <div>
                <dt className="label">Where</dt>
                <dd className="soft">
                  {orUnset(
                    [info.addressLine1, info.addressLine2, info.city].filter(Boolean).join(", "),
                    "Address not recorded yet — check the contact page",
                  )}
                </dd>
              </div>
              <div>
                <dt className="label">Telephone</dt>
                <dd className="soft">{info.phonePrimary ? <a href={`tel:${info.phonePrimary}`} className="hover:text-brand">{info.phonePrimary}</a> : "No number recorded yet"}</dd>
              </div>
              <div>
                <dt className="label">Local time</dt>
                <dd className="soft">
                  {site.clock} ({site.timeZone}) — today is {site.todayKey}
                </dd>
              </div>
            </dl>
          </div>

          <div className="card overflow-hidden">
            <MenuImage src={featured[0]?.imageUrl ?? null} alt={featured[0]?.name ?? "From our grill"} className="h-56 w-full object-cover" />
            <div className="p-4">
              <p className="text-sm font-semibold">{featured[0]?.name ?? "From the menu"}</p>
              <p className="hint mt-1">
                {featured[0] ? `${featured[0].categoryName} · ${featured[0].servesInfo ?? "serves info not recorded"}` : "Photos are added by our team in the menu screen."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="shell py-12">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Popular from the grill</h2>
          <Link href="/menu" className="btn btn-ghost btn-sm">
            Full menu
          </Link>
        </div>

        {featured.length === 0 ? (
          <p className="notice mt-6">
            Nothing is marked as a signature dish yet, and we would rather show you an honest empty shelf than invented
            food. The menu page lists whatever our team has published.
          </p>
        ) : (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((item) => (
              <li key={item.id}>
                <Link href={`/menu/${item.slug}`} className="card card-hover block overflow-hidden">
                  <MenuImage src={item.imageUrl} alt={item.name} />
                  <div className="p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{item.name}</p>
                      <Price poisa={item.pricePoisa} symbol={site.money.currencySymbol} />
                    </div>
                    <p className="hint mt-1">{item.categoryName}</p>
                    {item.description ? <p className="mt-2 line-clamp-3 text-sm soft">{item.description}</p> : null}
                    {!item.available ? <p className="badge badge-closed mt-2">Not available right now</p> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-y border-line bg-paper-raised">
        <div className="shell grid gap-6 py-12 md:grid-cols-3">
          <div>
            <h3 className="text-base font-bold">At the table</h3>
            <p className="mt-2 text-sm soft">
              Scan the QR code on your table and the menu opens on your phone with this visit already attached. Orders
              go straight to the kitchen; the bill and its total are the restaurant&apos;s, not ours to guess.
            </p>
          </div>
          <div>
            <h3 className="text-base font-bold">Takeaway &amp; delivery</h3>
            <p className="mt-2 text-sm soft">
              {info.allowTakeaway || info.allowDelivery
                ? [info.allowTakeaway ? "Takeaway collection" : null, info.allowDelivery ? "Delivery" : null].filter(Boolean).join(" and ") + " are open right now. Any delivery charge is set by the restaurant and shown before you confirm."
                : "We are not taking takeaway or delivery orders online right now — please call us or order at the counter."}
            </p>
          </div>
          <div>
            <h3 className="text-base font-bold">Payments</h3>
            <p className="mt-2 text-sm soft">
              Pay at the counter or online from the table. An online payment is recorded as paid only when the bank
              confirms it to us — a page that merely loads again proves nothing.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="shell space-y-4 py-16">
      <span className="skeleton block h-8 w-52" />
      <span className="skeleton block h-12 w-80" />
      <span className="skeleton block h-4 w-full max-w-prose" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <span key={index} className="skeleton block h-64" />
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeBody />
    </Suspense>
  );
}
