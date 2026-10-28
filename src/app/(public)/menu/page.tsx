import Link from "next/link";
import { Suspense } from "react";
import { listCategories, listMenuItems } from "@/server/services/menu.service";
import { siteContext } from "@/server/http/site";
import { bpsToPercentLabel } from "@/lib/money";
import { MenuImage, Price } from "@/components/ui/menu-image";
import { QuickAdd } from "@/components/site/quick-add";

function spiceLabel(level: number) {
  if (level <= 0) return null;
  return "🌶".repeat(Math.min(5, level));
}

async function MenuBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const category = typeof params.category === "string" ? params.category : undefined;
  const q = typeof params.q === "string" ? params.q : undefined;

  const [site, categories, items] = await Promise.all([
    siteContext(),
    listCategories({ activeOnly: true }),
    listMenuItems({ categorySlug: category, search: q, includeUnavailable: true }),
  ]);
  const symbol = site.money.currencySymbol;

  return (
    <div className="shell py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Our menu</h1>
          <p className="mt-1 text-sm soft">
            Prices are the ones on the counter. Charges shown at the bottom of this page apply on top.
          </p>
        </div>
        <form className="flex gap-2" action="/menu">
          {category ? <input type="hidden" name="category" value={category} readOnly /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search dishes"
            className="input w-56"
            aria-label="Search the menu"
          />
          <button type="submit" className="btn btn-outline">
            Search
          </button>
        </form>
      </header>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Menu categories">
        <Link href="/menu" className={category ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}>
          Everything
        </Link>
        {categories.map((cat) => {
          const active = cat.slug === category;
          const available = cat._count.items;
          return (
            <Link
              key={cat.id}
              href={`/menu?category=${encodeURIComponent(cat.slug)}`}
              className={active ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            >
              {cat.name}
              <span className="ml-1 muted">({available})</span>
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="notice mt-8">
          {q || category
            ? "Nothing matches that search. Clear the filter or try a different spelling — if a dish you expect is missing, tell us at the counter and we will look at the menu."
            : "No dishes are published yet. Our team adds them from the admin panel; until then please ask at the counter."}
        </p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="card overflow-hidden flex flex-col">
              <Link href={`/menu/${item.slug}`} className="block">
                <MenuImage src={item.imageUrl} alt={item.name} />
              </Link>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/menu/${item.slug}`} className="font-semibold hover:text-brand">
                    {item.name}
                  </Link>
                  <Price poisa={item.pricePoisa} symbol={symbol} />
                </div>
                <p className="hint mt-1">
                  {item.categoryName}
                  {item.servesInfo ? ` · ${item.servesInfo}` : ""}
                  {spiceLabel(item.spicyLevel) ? ` · ${spiceLabel(item.spicyLevel)}` : ""}
                </p>
                {item.description ? (
                  <p className="mt-2 line-clamp-3 text-sm soft">{item.description}</p>
                ) : null}
                <div className="mt-4 flex items-center gap-2">
                  {item.available ? (
                    item.requiredGroupCount === 0 ? (
                      <QuickAdd item={{ id: item.id, name: item.name, slug: item.slug, pricePoisa: item.pricePoisa }} symbol={symbol} />
                    ) : (
                      <Link href={`/menu/${item.slug}`} className="btn btn-outline btn-sm">
                        Choose &amp; add
                      </Link>
                    )
                  ) : (
                    <span className="badge badge-closed">Not available right now</span>
                  )}
                  {item.prepMinutes ? <span className="hint">{item.prepMinutes} min to cook</span> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10 card p-5">
        <h2 className="text-base font-bold">What is added at the counter</h2>
        <p className="mt-2 text-sm soft">
          {site.money.serviceChargeBps > 0
            ? `A service charge of ${bpsToPercentLabel(site.money.serviceChargeBps)}% is added to the food subtotal.`
            : "No service charge is added."}{" "}
          {site.money.vatBps > 0
            ? `VAT of ${bpsToPercentLabel(site.money.vatBps)}% applies${site.money.vatOnServiceCharge ? " including the service charge" : " on the food subtotal only"}.`
            : "No VAT line is configured."}{" "}
          The exact figures are on your bill — we do not round them in your favour or ours.
        </p>
      </section>
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="shell py-10">
      <span className="skeleton block h-9 w-48" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className="skeleton block h-64" />
        ))}
      </div>
    </div>
  );
}

export default function MenuPage(props: PageProps<"/menu">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuBody searchParams={props.searchParams} />
    </Suspense>
  );
}
