import Link from "next/link";
import { Suspense } from "react";
import { orUnset, siteContext } from "@/server/http/site";
import { listCategories } from "@/server/services/menu.service";

async function AboutBody() {
  const [site, categories] = await Promise.all([siteContext(), listCategories({ activeOnly: true })]);
  const { info } = site;
  const address = [info.addressLine1, info.addressLine2, info.city].filter(Boolean).join(", ");

  return (
    <div className="shell max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">About {info.name}</h1>

      {info.contactNote ? (
        <p className="mt-4 text-base soft">{info.contactNote}</p>
      ) : (
        <p className="notice mt-4">
          The story of this kitchen is not ours to write. Staff can add it in the admin panel under Settings → note for
          the website, and it will appear here. What follows is only what the systems can prove.
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold">What is on the menu today</h2>
        <p className="mt-1 text-sm soft">
          {categories.length === 0
            ? "No sections are published yet."
            : `${categories.length} section${categories.length === 1 ? "" : "s"}: ${categories
                .map((category) => `${category.name} (${category._count.items})`)
                .join(", ")}. Those counts are dishes the kitchen has marked available right now, read from the database at the moment you loaded this page.`}
        </p>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-bold">How ordering works here</h2>
          <ol className="mt-2 space-y-2 text-sm soft">
            <li>Scan the code on your table. It opens this visit — no app, no account.</li>
            <li>
              Your dishes go to the kitchen with the table&apos;s own order number, and the screen shows what the staff
              see.
            </li>
            <li>
              The bill is drawn up by the restaurant. Charges, VAT and any rounding appear as the restaurant applies
              them.
            </li>
            <li>Pay at the counter, or online from the table once the bill is final.</li>
          </ol>
        </div>
        <div className="card p-5">
          <h2 className="text-base font-bold">What we do not do</h2>
          <ul className="mt-2 space-y-2 text-sm soft">
            <li>A price is never taken from your phone. The server re-reads every dish from the menu when you order.</li>
            <li>An online payment is marked paid when the bank tells us, not when your browser comes back.</li>
            <li>Nothing on this site is invented: an unset address, phone or opening hour is shown as not recorded.</li>
            <li>The assistant answers from the menu and the restaurant&apos;s own settings, and says when it does not know.</li>
          </ul>
        </div>
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold">Find us</h2>
        <p className="mt-2 text-sm soft">
          {orUnset(address, "Address not recorded yet")} · {info.phonePrimary ? info.phonePrimary : "telephone not recorded"} ·{" "}
          {site.hours}
        </p>
        <p className="mt-3 flex flex-wrap gap-3">
          <Link href="/reservations" className="btn btn-primary btn-sm">
            Book a table
          </Link>
          <Link href="/contact" className="btn btn-outline btn-sm">
            Contact page
          </Link>
        </p>
      </section>
    </div>
  );
}

export default function AboutPage() {
  return (
    <Suspense
      fallback={
        <div className="shell max-w-3xl py-10">
          <span className="skeleton block h-9 w-64" />
          <span className="skeleton mt-6 block h-64" />
        </div>
      }
    >
      <AboutBody />
    </Suspense>
  );
}
