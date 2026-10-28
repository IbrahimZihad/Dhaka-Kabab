import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getMenuItemBySlug } from "@/server/services/menu.service";
import { siteContext } from "@/server/http/site";
import { orUnset } from "@/server/http/site";
import { MenuImage } from "@/components/ui/menu-image";
import { ItemCustomizer, type CustomizerItem } from "@/components/site/item-customizer";

async function ItemBody({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [item, site] = await Promise.all([getMenuItemBySlug(slug), siteContext()]);
  if (!item) notFound();

  const symbol = site.money.currencySymbol;

  const customizer: CustomizerItem = {
    id: item.id,
    name: item.name,
    slug: item.slug,
    pricePoisa: item.pricePoisa,
    groups: item.customizationGroups.map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDeltaPoisa: option.priceDeltaPoisa,
      })),
    })),
  };

  return (
    <div className="shell py-10">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/menu" className="hover:text-brand">
          Menu
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/menu?category=${encodeURIComponent(item.category.slug)}`} className="hover:text-brand">
          {item.category.name}
        </Link>
        <span className="mx-2">/</span>
        <span>{item.name}</span>
      </nav>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">{item.name}</h1>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <MenuImage
            src={item.imageUrl}
            alt={item.name}
            width={900}
            height={700}
            className="h-72 w-full rounded-lg object-cover"
          />
          {!item.available ? (
            <p className="notice notice-error mt-4">
              The kitchen has this off the list right now. It stays visible so you know it exists — ask at the counter
              when it returns.
            </p>
          ) : null}

          <dl className="mt-6 space-y-3 text-sm">
            <div>
              <dt className="label">Description</dt>
              <dd className="soft">{item.description ?? orUnset(item.description, "Our team has not written one yet.")}</dd>
            </div>
            <div>
              <dt className="label">Contains</dt>
              <dd className="soft">{orUnset(item.ingredients, "Ingredients not recorded — please ask staff, especially if you have an allergy.")}</dd>
            </div>
            <div>
              <dt className="label">Allergens</dt>
              <dd className="soft">{orUnset(item.allergens, "Not recorded — tell the kitchen about any allergy before ordering.")}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="label">Serves</dt>
                <dd className="soft">{orUnset(item.servesInfo, "not recorded")}</dd>
              </div>
              <div>
                <dt className="label">Cooking time</dt>
                <dd className="soft">{item.prepMinutes ? `${item.prepMinutes} minutes` : "not recorded"}</dd>
              </div>
            </div>
            <div>
              <dt className="label">Heat</dt>
              <dd className="soft">{item.spicyLevel > 0 ? `${item.spicyLevel} of 5` : "Mild"}</dd>
            </div>
          </dl>
        </div>

        <div>
          <div className="mt-6">
            {item.available ? (
              <ItemCustomizer item={customizer} symbol={symbol} />
            ) : (
              <p className="notice">Ordering is closed for this dish while the kitchen has it unavailable.</p>
            )}
          </div>
          <p className="hint mt-4">
            Adding to your order does not place it. Nothing reaches the kitchen until you confirm on the next screen,
            and the total there is the restaurant&apos;s own, recalculated from these prices.
          </p>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata(props: PageProps<"/menu/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const item = await getMenuItemBySlug(slug);
  if (!item) return { title: "Dish not found" };
  return {
    title: `${item.name} — menu`,
    description: item.description ?? `${item.name} from the ${item.category.name} section of our menu.`,
  };
}

function ItemSkeleton() {
  return (
    <div className="shell grid gap-8 py-10 lg:grid-cols-2">
      <span className="skeleton block h-72" />
      <div className="space-y-3">
        <span className="skeleton block h-9 w-56" />
        <span className="skeleton block h-64" />
      </div>
    </div>
  );
}

export default function MenuItemPage(props: PageProps<"/menu/[slug]">) {
  return (
    <Suspense fallback={<ItemSkeleton />}>
      <ItemBody params={props.params} />
    </Suspense>
  );
}
