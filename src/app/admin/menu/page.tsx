import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { formatPoisa } from "@/lib/money";
import { getSettings } from "@/server/services/settings.service";
import { listCategories, listMenuItems, type MenuListItem } from "@/server/services/menu.service";
import { AdminTable, EmptyState, Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { MenuCategoryEditor, MenuCategoryForm, type CategoryRow } from "@/components/admin/menu-category-form";
import { MenuItemCreate } from "@/components/admin/menu-item-form";
import { MenuRowActions, MenuRestoreButton, CategoryRestoreButton } from "@/components/admin/menu-row-actions";

export const metadata: Metadata = { title: "Menu" };

const AVAIL_OPTIONS = [
  { value: "", label: "Available and sold out" },
  { value: "yes", label: "Available only" },
  { value: "no", label: "Sold out only" },
] as const;

type AvailKey = (typeof AVAIL_OPTIONS)[number]["value"];

function filterValue(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

type Filters = { search: string; category: string; available: AvailKey };

function readFilters(params: Record<string, string | string[] | undefined>): Filters {
  const rawAvailable = filterValue(params.available);
  const available = (AVAIL_OPTIONS as readonly { value: string }[]).some((option) => option.value === rawAvailable)
    ? (rawAvailable as AvailKey)
    : "";
  return {
    search: filterValue(params.search).slice(0, 60),
    category: filterValue(params.category).slice(0, 72),
    available,
  };
}

function hrefFor(base: string, filters: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.search) query.set("search", merged.search);
  if (merged.category) query.set("category", merged.category);
  if (merged.available) query.set("available", merged.available);
  const suffix = query.toString();
  return suffix ? `${base}?${suffix}` : base;
}

function MenuSkeleton() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-40" />
      <span className="skeleton block h-28" />
      <span className="skeleton block h-40" />
      <span className="skeleton block h-96" />
    </div>
  );
}

function AvailabilityBadge({ available }: { available: boolean }) {
  return available ? <StatusBadge status="On the menu" /> : <span className="badge badge-closed">Sold out</span>;
}

function DishRow({
  item,
  symbol,
  canManage,
}: {
  item: MenuListItem;
  symbol: string;
  canManage: boolean;
}) {
  return (
    <tr className="border-b border-line">
      <td className="px-3 py-2">
        <Link href={`/admin/menu/${item.id}`} className="font-semibold underline">
          {item.name}
        </Link>
        {item.featured ? <span className="badge badge-brand ml-2">Featured</span> : null}
        <span className="hint block">
          <a href={`/menu/${item.slug}`} target="_blank" rel="noreferrer" className="underline">
            See the guest page
          </a>
          {item.requiredGroupCount > 0 ? ` · ${item.requiredGroupCount} required choice${item.requiredGroupCount === 1 ? "" : "s"}` : ""}
        </span>
      </td>
      <td className="px-3 py-2">
        <Link href={hrefFor("/admin/menu", { search: "", category: item.categorySlug, available: "" })} className="badge">
          {item.categoryName}
        </Link>
      </td>
      <td className="px-3 py-2 price">{formatPoisa(item.pricePoisa, { symbol })}</td>
      <td className="px-3 py-2">
        <AvailabilityBadge available={item.available} />
      </td>
      <td className="px-3 py-2 muted tabular-nums">{item.prepMinutes != null ? `${item.prepMinutes} min` : "—"}</td>
      <td className="px-3 py-2 muted tabular-nums">{item.spicyLevel > 0 ? `${item.spicyLevel}/5` : "Mild"}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={`/admin/menu/${item.id}`} className="btn btn-outline btn-sm">
            Edit
          </Link>
          {canManage ? <MenuRowActions item={{ id: item.id, name: item.name, available: item.available, featured: item.featured }} /> : null}
        </div>
      </td>
    </tr>
  );
}

async function MenuView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "menu:view:admin")) {
    return (
      <Panel title="Menu" description="The menu editor belongs to the roles that set prices and dishes.">
        <p className="text-sm soft">
          Your role may not change the menu. Your screen is the{" "}
          <Link href="/kitchen" className="underline">
            kitchen display
          </Link>{" "}
          or the floor, where dishes are served but not authored.
        </p>
      </Panel>
    );
  }

  const canManage = roleHasPermission(user.role, "menu:manage");
  const canManageCategories = roleHasPermission(user.role, "category:manage");

  const filters = readFilters(await searchParams);
  const settings = await getSettings();
  const symbol = settings.currencySymbol;

  let failure: string | null = null;
  let categoryRows: CategoryRow[] = [];
  let items: MenuListItem[] = [];
  let archived: MenuListItem[] = [];
  let archivedCategories: { id: string; name: string; slug: string }[] = [];

  try {
    const [categories, listed, withArchived] = await Promise.all([
      listCategories({ activeOnly: false }),
      listMenuItems({
        search: filters.search || undefined,
        categorySlug: filters.category || undefined,
        includeUnavailable: true,
      }),
      // A second read that also returns archived rows, so dishes taken off the menu
      // can be listed separately with a way back. Prices and detail are re-read from
      // the database here, never trusted from the browser.
      listMenuItems({
        search: filters.search || undefined,
        categorySlug: filters.category || undefined,
        includeArchived: true,
        includeUnavailable: true,
      }),
    ]);
    categoryRows = categories
      .filter((category) => !category.archivedAt)
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        imageUrl: category.imageUrl,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        dishCount: category._count.items,
      }));
    // An archived section is hidden from guests, but the manager still has to be
    // able to see it and put it back — otherwise archiving is irreversible.
    archivedCategories = categories
      .filter((category) => category.archivedAt !== null)
      .map((category) => ({ id: category.id, name: category.name, slug: category.slug }));
    items =
      filters.available === "yes"
        ? listed.filter((item) => item.available)
        : filters.available === "no"
          ? listed.filter((item) => !item.available)
          : listed;
    const liveIds = new Set(listed.map((item) => item.id));
    archived = withArchived.filter((item) => !liveIds.has(item.id));
  } catch (error) {
    failure = error instanceof Error ? error.message : "The menu could not be read.";
  }

  const categoryOptions = categoryRows.filter((category) => category.isActive).map((category) => ({ id: category.id, name: category.name }));
  const totalDishes = categoryRows.reduce((sum, category) => sum + category.dishCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Menu</h1>
          <p className="hint mt-1">
            Sections, dishes, prices and the choices a guest makes on each dish. Prices are stored in poisa by the
            server; you type them in taka. Figures cover {totalDishes} available dish{totalDishes === 1 ? "" : "es"}
            .
          </p>
        </div>
      </div>

      {failure ? (
        <Note kind="error">
          {failure} Nothing was changed — the menu is where it was.{" "}
          <Link href="/admin/menu" className="underline">
            Reload without the filters
          </Link>
          .
        </Note>
      ) : null}

      <Panel title="Find dishes" description="Filters live in the address, so a view survives a reload or a shared link.">
        <form method="get" action="/admin/menu" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="menu-search">
              Dish name
            </label>
            <input id="menu-search" type="search" name="search" maxLength={60} defaultValue={filters.search} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="menu-category">
              Section
            </label>
            <select id="menu-category" name="category" defaultValue={filters.category} className="select mt-1">
              <option value="">All sections</option>
              {categoryRows.map((category) => (
                <option key={category.id} value={category.slug}>
                  {category.name}
                  {category.isActive ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="menu-available">
              Availability
            </label>
            <select id="menu-available" name="available" defaultValue={filters.available} className="select mt-1">
              {AVAIL_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-outline btn-sm">
              Show
            </button>
            <Link href="/admin/menu" className="btn btn-ghost btn-sm">
              Reset
            </Link>
          </div>
        </form>
      </Panel>

      <Panel
        title="Sections"
        description="Categories order the guest menu and hold dishes. Hide a section to take it off the menu without deleting it."
        actions={canManageCategories ? <MenuCategoryForm /> : null}
      >
        {!canManageCategories ? (
          <p className="hint mb-3">Your role can read the menu but not change sections; only a manager or owner edits them.</p>
        ) : null}
        {categoryRows.length === 0 ? (
          <EmptyState title="No sections yet">
            {canManageCategories
              ? "Add a section first — every dish must belong to one."
              : "None recorded. A manager or owner can add one."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {categoryRows.map((category) => (
              <li key={category.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {category.name}
                    {!category.isActive ? <span className="badge badge-closed ml-2">Hidden</span> : null}
                    <span className="badge ml-2">Order {category.sortOrder}</span>
                  </p>
                  <p className="hint mt-0.5">
                    /{category.slug} · {category.dishCount} available dish{category.dishCount === 1 ? "" : "es"}
                  </p>
                </div>
                {canManageCategories ? <MenuCategoryEditor category={category} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Dishes"
        description={
          filters.search || filters.category || filters.available
            ? `${items.length} dish${items.length === 1 ? "" : "es"} in this view.`
            : `${items.length} dish${items.length === 1 ? "" : "es"} (available and sold out).`
        }
        actions={canManage ? <MenuItemCreate symbol={symbol} categories={categoryOptions} /> : null}
      >
        {!failure && items.length === 0 ? (
          categoryRows.length === 0 ? (
            <EmptyState title="No dishes yet — add a section first">
              A dish must belong to a section. Create a section above, then add dishes to it.
            </EmptyState>
          ) : (
            <EmptyState title="No dishes match this view">
              {filters.search ? `Nothing named like “${filters.search}”. ` : ""}
              {filters.available === "no" ? "Nothing is currently marked sold out. " : ""}
              {archived.length > 0 && !filters.available ? "Dishes taken off the menu are listed below, separately. " : ""}
              <Link href="/admin/menu" className="underline">
                Clear the filters
              </Link>{" "}
              to see the whole menu.
            </EmptyState>
          )
        ) : (
          <AdminTable head={["Dish", "Section", "Price", "Availability", "Prep", "Heat", ""]}>
            {items.map((item) => (
              <DishRow key={item.id} item={item} symbol={symbol} canManage={canManage} />
            ))}
          </AdminTable>
        )}
      </Panel>

      {!failure && archived.length > 0 ? (
        <Panel
          title="Off the menu (archived)"
          description="Dishes taken off the menu are kept, never erased, so past bills and receipts still read correctly. Put one back to make it orderable again."
        >
          <AdminTable head={["Dish", "Section", "Price", ""]}>
            {archived.map((item) => (
              <tr key={item.id} className="border-b border-line">
                <td className="px-3 py-2">
                  <Link href={`/admin/menu/${item.id}`} className="font-semibold underline">
                    {item.name}
                  </Link>
                  <span className="hint block">Kept on record — not permanently deleted.</span>
                </td>
                <td className="px-3 py-2">
                  <span className="badge">{item.categoryName}</span>
                </td>
                <td className="px-3 py-2 price">{formatPoisa(item.pricePoisa, { symbol })}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Link href={`/admin/menu/${item.id}`} className="btn btn-outline btn-sm">
                      Open
                    </Link>
                    {canManage ? <MenuRestoreButton item={{ id: item.id, name: item.name }} /> : null}
                  </div>
                </td>
              </tr>
            ))}
          </AdminTable>
        </Panel>
      ) : null}

      {!failure && archivedCategories.length > 0 ? (
        <Panel
          title="Sections off the menu (archived)"
          description="An archived section stays hidden from guests and keeps its name reserved, so dishes and receipts that mention it still read correctly. Put one back to file dishes under it again."
        >
          <AdminTable head={["Section", "Slug", ""]}>
            {archivedCategories.map((category) => (
              <tr key={category.id} className="border-b border-line">
                <td className="px-3 py-2 font-semibold">{category.name}</td>
                <td className="px-3 py-2 soft">{category.slug}</td>
                <td className="px-3 py-2">
                  {canManage ? <CategoryRestoreButton category={category} /> : <span className="hint">Only a manager can restore a section.</span>}
                </td>
              </tr>
            ))}
          </AdminTable>
        </Panel>
      ) : null}
    </div>
  );
}

export default function AdminMenuPage(props: PageProps<"/admin/menu">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuView searchParams={props.searchParams} />
    </Suspense>
  );
}
