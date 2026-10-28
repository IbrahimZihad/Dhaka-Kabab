import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa } from "@/lib/money";
import { AppError } from "@/lib/errors";
import { orUnset } from "@/server/http/site";
import { getSettings } from "@/server/services/settings.service";
import { getMenuItemForAdmin, listCategories } from "@/server/services/menu.service";
import { EmptyState, Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { MenuItemForm, type DishRecord } from "@/components/admin/menu-item-form";
import { MenuCustomizer, type GroupRow } from "@/components/admin/menu-customizer";
import { DishLifecycle } from "@/components/admin/menu-dish-lifecycle";

type DishDetail = {
  dish: DishRecord;
  groups: GroupRow[];
  categoryOptions: { id: string; name: string }[];
  archived: boolean;
  publicSlug: string;
  categoryName: string;
};

function Skeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-72" />
      <span className="skeleton block h-96" />
      <span className="skeleton block h-48" />
    </div>
  );
}

async function DishBody({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "menu:view:admin")) {
    return (
      <Panel title="Dish" description="This page belongs to the roles that tend the menu.">
        <p className="text-sm soft">
          Your role may not view or change dishes. Head back to the{" "}
          <Link href="/kitchen" className="underline">
            kitchen display
          </Link>
          .
        </p>
      </Panel>
    );
  }

  const canManage = roleHasPermission(user.role, "menu:manage");

  const { id } = await params;
  const [settings, item, categories] = await Promise.all([
    getSettings(),
    getMenuItemForAdmin(id).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "NOT_FOUND") return null;
      throw error;
    }),
    listCategories({ activeOnly: false }),
  ]);
  const symbol = settings.currencySymbol;
  if (!item) {
    return (
      <div className="space-y-4">
        <Note kind="error">No dish is recorded with that reference. It may have been taken off and its link changed.</Note>
        <Link href="/admin/menu" className="btn btn-outline btn-sm">
          Back to the menu
        </Link>
      </div>
    );
  }

  const activeCategories = categories
    .filter((category) => !category.archivedAt && category.isActive)
    .map((category) => ({ id: category.id, name: category.name }));
  if (!activeCategories.some((category) => category.id === item.categoryId)) {
    activeCategories.push({ id: item.categoryId, name: item.category.name });
  }

  const detail: DishDetail = {
    dish: {
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      categoryId: item.categoryId,
      pricePoisa: item.pricePoisa,
      imageUrl: item.imageUrl,
      available: item.available,
      featured: item.featured,
      prepMinutes: item.prepMinutes,
      ingredients: item.ingredients,
      allergens: item.allergens,
      spicyLevel: item.spicyLevel,
      servesInfo: item.servesInfo,
      sortOrder: item.sortOrder,
    },
    groups: item.customizationGroups.map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      sortOrder: group.sortOrder,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDeltaPoisa: option.priceDeltaPoisa,
        available: option.available,
        sortOrder: option.sortOrder,
      })),
    })),
    categoryOptions: activeCategories,
    archived: item.archivedAt !== null,
    publicSlug: item.slug,
    categoryName: item.category.name,
  };

  const ownCategory = categories.find((category) => category.id === item.categoryId);
  const onPublicMenu =
    item.archivedAt === null && item.available && Boolean(ownCategory) && ownCategory!.isActive && ownCategory!.archivedAt === null;
  const publicReason = item.archivedAt
    ? "It is off the menu (archived), so no guest can see it."
    : !item.available
      ? "It is marked sold out, so guests see the dish with a note that it cannot be ordered right now."
      : ownCategory && (!ownCategory.isActive || ownCategory.archivedAt)
        ? `Its section (${item.category.name}) is hidden from guests, so the dish does not reach the menu.`
        : "It is on the public menu and can be ordered.";
  const requiredGroups = detail.groups.filter(
    (group) => group.required && group.options.some((option) => option.available),
  );

  return (
    <div className="space-y-6">
      <nav className="text-sm muted" aria-label="Breadcrumb">
        <Link href="/admin/menu" className="underline">
          Menu
        </Link>
        <span className="mx-2">/</span>
        <span>{detail.dish.name}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{detail.dish.name}</h1>
          <p className="hint mt-1">
            {detail.categoryName} · priced at {formatPoisa(detail.dish.pricePoisa, { symbol })} as stored by the server.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            {detail.dish.available ? (
              <StatusBadge status="On the menu" />
            ) : (
              <span className="badge badge-closed">Sold out</span>
            )}
            {detail.dish.featured ? <span className="badge badge-brand">Featured</span> : null}
            {detail.archived ? <span className="badge badge-closed">Off the menu</span> : null}
            <a href={`/menu/${detail.publicSlug}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              See what a guest sees
            </a>
          </p>
          <p className="hint mt-2">
            <span className="label">Guest page:</span> <span className="font-mono">/menu/{detail.publicSlug}</span> ·{" "}
            {onPublicMenu ? <span className="badge badge-open">On the public menu</span> : <span className="badge badge-closed">Not on the public menu</span>}{" "}
            {publicReason}
          </p>
        </div>
      </div>

      {!canManage ? (
        <Note kind="info">
          Your role can read the menu but not change it. Only a manager or owner edits dishes, prices and choices.
        </Note>
      ) : null}

      {canManage ? (
        <Panel title="Dish details" description="Name, section, price and the words a guest reads. Price is typed in taka.">
          <MenuItemForm mode="edit" symbol={symbol} categories={detail.categoryOptions} dish={detail.dish} />
        </Panel>
      ) : (
        <Panel title="What a guest reads" description="The recorded detail; unset lines say so plainly.">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="label">Description</dt>
              <dd className="soft">{orUnset(detail.dish.description)}</dd>
            </div>
            <div>
              <dt className="label">Ingredients</dt>
              <dd className="soft">{orUnset(detail.dish.ingredients)}</dd>
            </div>
            <div>
              <dt className="label">Allergens</dt>
              <dd className="soft">{orUnset(detail.dish.allergens)}</dd>
            </div>
            <div>
              <dt className="label">Serves</dt>
              <dd className="soft">{orUnset(detail.dish.servesInfo)}</dd>
            </div>
          </dl>
        </Panel>
      )}

      <Panel
        title="Choices on this dish"
        description="Groups like size, spice or a side. Each option carries a price change in taka; the guest's choices are added at checkout."
      >
        {requiredGroups.length > 0 ? (
          <Note kind="info">
            {requiredGroups.length} required choice{requiredGroups.length === 1 ? "" : "s"} here:{" "}
            {requiredGroups.map((group) => group.name).join(", ")}. A guest cannot order this dish without choosing from
            every one of them.
          </Note>
        ) : null}
        {canManage ? (
          <MenuCustomizer itemId={detail.dish.id} symbol={symbol} groups={detail.groups} />
        ) : detail.groups.length === 0 ? (
          <EmptyState title="No choices recorded" />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {detail.groups.map((group) => (
              <li key={group.id} className="py-2">
                <p className="font-semibold">
                  {group.name}
                  {group.required ? " — required" : ""}
                </p>
                <p className="hint">
                  {group.options.map((option) => `${option.name} (${formatPoisa(option.priceDeltaPoisa, { symbol })})`).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canManage ? (
        <Panel title="On or off the menu" description="Selling state and removal, kept separate so nothing is lost by accident.">
          <DishLifecycle dish={{ id: detail.dish.id, name: detail.dish.name, archived: detail.archived }} />
        </Panel>
      ) : null}
    </div>
  );
}

export default function AdminMenuDishPage(props: PageProps<"/admin/menu/[id]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <DishBody params={props.params} />
    </Suspense>
  );
}
