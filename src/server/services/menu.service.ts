import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/ids";
import type { CategoryInput, MenuItemInput } from "@/server/validation/menu";

/**
 * Menu catalogue. Prices live here; every monetary figure a customer sees is
 * re-read from this table at order time, never taken from the browser.
 */

export type MenuListItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pricePoisa: number;
  imageUrl: string | null;
  available: boolean;
  featured: boolean;
  prepMinutes: number | null;
  ingredients: string | null;
  allergens: string | null;
  spicyLevel: number;
  servesInfo: string | null;
  categoryName: string;
  categorySlug: string;
  /** Groups that force a choice, so the menu knows whether one tap can add this. */
  requiredGroupCount: number;
};

const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  pricePoisa: true,
  imageUrl: true,
  available: true,
  featured: true,
  prepMinutes: true,
  ingredients: true,
  allergens: true,
  spicyLevel: true,
  servesInfo: true,
  category: { select: { name: true, slug: true } },
  _count: {
    select: {
      customizationGroups: { where: { required: true, options: { some: { available: true } } } },
    },
  },
} as const;

export async function listCategories(options: { activeOnly?: boolean } = {}, client: Db = prisma) {
  return client.menuCategory.findMany({
    where: { ...(options.activeOnly === false ? {} : { isActive: true, archivedAt: null }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { items: { where: { archivedAt: null, available: true } } } },
    },
  });
}

export type MenuFilters = {
  search?: string;
  categorySlug?: string;
  featuredOnly?: boolean;
  includeUnavailable?: boolean;
  includeArchived?: boolean;
};

export async function listMenuItems(filters: MenuFilters = {}, client: Db = prisma): Promise<MenuListItem[]> {
  const items = await client.menuItem.findMany({
    where: {
      ...(filters.includeArchived ? {} : { archivedAt: null }),
      ...(filters.includeUnavailable ? {} : { available: true }),
      ...(filters.featuredOnly ? { featured: true } : {}),
      ...(filters.categorySlug ? { category: { slug: filters.categorySlug, isActive: true } } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { description: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: LIST_SELECT,
  });
  return items.map(mapListItem);
}

function mapListItem(item: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pricePoisa: number;
  imageUrl: string | null;
  available: boolean;
  featured: boolean;
  prepMinutes: number | null;
  ingredients: string | null;
  allergens: string | null;
  spicyLevel: number;
  servesInfo: string | null;
  category: { name: string; slug: string };
  _count: { customizationGroups: number };
}): MenuListItem {
  const { _count, ...rest } = item;
  return {
    ...rest,
    categoryName: item.category.name,
    categorySlug: item.category.slug,
    requiredGroupCount: _count.customizationGroups,
  };
}

export async function getMenuItemBySlug(slug: string, client: Db = prisma) {
  const item = await client.menuItem.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, slug: true } },
      customizationGroups: {
        where: { options: { some: { available: true } } },
        orderBy: { sortOrder: "asc" },
        include: { options: { where: { available: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!item || item.archivedAt) return null;
  return item;
}

/** Admin edit view: archived items and unavailable options are included. */
export async function getMenuItemForAdmin(id: string) {
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      category: { select: { name: true, slug: true } },
      customizationGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!item) throw new AppError("NOT_FOUND", "Menu item not found.");
  return item;
}

export async function getFeaturedItems(limit = 6, client: Db = prisma): Promise<MenuListItem[]> {
  const items = await client.menuItem.findMany({
    where: { featured: true, available: true, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: Math.min(24, Math.max(1, limit)),
    select: LIST_SELECT,
  });
  return items.map(mapListItem);
}

/** Compact, authoritative catalogue for the chatbot's grounding context. */
export async function getMenuSnapshotForChat(client: Db = prisma) {
  const items = await client.menuItem.findMany({
    where: { archivedAt: null },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: {
      name: true,
      pricePoisa: true,
      available: true,
      description: true,
      ingredients: true,
      allergens: true,
      category: { select: { name: true } },
    },
    take: 200,
  });
  return items;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function createCategory(input: CategoryInput, actorUserId: string | null, ip?: string) {
  const slug = input.slug ?? slugify(input.name);
  const clash = await prisma.menuCategory.findUnique({ where: { slug } });
  if (clash) throw new AppError("CONFLICT", `A category with the slug "${slug}" already exists.`);
  const category = await prisma.menuCategory.create({
    data: { name: input.name, slug, description: input.description ?? null, imageUrl: input.imageUrl ?? null, sortOrder: input.sortOrder, isActive: input.isActive },
  });
  await writeAudit({ actorUserId, action: "category.create", entityType: "MenuCategory", entityId: category.id, after: category, ip });
  return category;
}

export async function updateCategory(id: string, input: CategoryInput, actorUserId: string | null, ip?: string) {
  const before = await prisma.menuCategory.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND", "Category not found.");
  const slug = input.slug ?? before.slug;
  if (slug !== before.slug && (await prisma.menuCategory.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", `A category with the slug "${slug}" already exists.`);
  }
  const category = await prisma.menuCategory.update({
    where: { id },
    data: { name: input.name, slug, description: input.description ?? null, imageUrl: input.imageUrl ?? null, sortOrder: input.sortOrder, isActive: input.isActive },
  });
  await writeAudit({ actorUserId, action: "category.update", entityType: "MenuCategory", entityId: id, before, after: category, ip });
  return category;
}

/**
 * Archiving keeps the row so historical orders and receipts still resolve.
 * Categories with live items cannot be archived — that would strand them.
 */
export async function archiveCategory(id: string, actorUserId: string | null, ip?: string) {
  const liveItems = await prisma.menuItem.count({ where: { categoryId: id, archivedAt: null } });
  if (liveItems > 0) {
    throw new AppError("CONFLICT", `Move or archive the ${liveItems} item(s) in this category first.`);
  }
  const category = await prisma.menuCategory.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
  await writeAudit({ actorUserId, action: "category.archive", entityType: "MenuCategory", entityId: id, ip });
  return category;
}

/**
 * Brings an archived category back. Without this the archive is a dead end: the
 * slug stays claimed and `createMenuItem` refuses to file a dish under an
 * archived category, so a mis-click can lock a section of the menu away.
 */
export async function restoreCategory(id: string, actorUserId: string | null, ip?: string) {
  const before = await prisma.menuCategory.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND", "Category not found.");
  if (!before.archivedAt) throw new AppError("VALIDATION", "That category is already on the menu.");
  const category = await prisma.menuCategory.update({ where: { id }, data: { archivedAt: null, isActive: true } });
  await writeAudit({ actorUserId, action: "category.restore", entityType: "MenuCategory", entityId: id, before, after: category, ip });
  return category;
}

export async function createMenuItem(input: MenuItemInput, actorUserId: string | null, ip?: string) {
  const category = await prisma.menuCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || category.archivedAt) throw new AppError("VALIDATION", "Choose an active category.");
  const slug = input.slug ?? slugify(input.name);
  if (await prisma.menuItem.findUnique({ where: { slug } })) {
    throw new AppError("CONFLICT", `A menu item with the slug "${slug}" already exists.`);
  }
  const item = await prisma.menuItem.create({
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      categoryId: input.categoryId,
      imageUrl: input.imageUrl ?? null,
      pricePoisa: input.pricePoisa,
      available: input.available,
      featured: input.featured,
      prepMinutes: input.prepMinutes ?? null,
      ingredients: input.ingredients ?? null,
      allergens: input.allergens ?? null,
      spicyLevel: input.spicyLevel,
      servesInfo: input.servesInfo ?? null,
      sortOrder: input.sortOrder,
    },
  });
  await writeAudit({ actorUserId, action: "menu.create", entityType: "MenuItem", entityId: item.id, after: item, ip });
  return item;
}

export async function updateMenuItem(id: string, input: MenuItemInput, actorUserId: string | null, ip?: string) {
  const before = await prisma.menuItem.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND", "Menu item not found.");
  const category = await prisma.menuCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || category.archivedAt) throw new AppError("VALIDATION", "Choose an active category.");
  const slug = input.slug ?? before.slug;
  const clash = await prisma.menuItem.findUnique({ where: { slug } });
  if (clash && clash.id !== id) throw new AppError("CONFLICT", `A menu item with the slug "${slug}" already exists.`);

  const item = await prisma.menuItem.update({
    where: { id },
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      categoryId: input.categoryId,
      imageUrl: input.imageUrl ?? null,
      pricePoisa: input.pricePoisa,
      available: input.available,
      featured: input.featured,
      prepMinutes: input.prepMinutes ?? null,
      ingredients: input.ingredients ?? null,
      allergens: input.allergens ?? null,
      spicyLevel: input.spicyLevel,
      servesInfo: input.servesInfo ?? null,
      sortOrder: input.sortOrder,
    },
  });
  await writeAudit({
    actorUserId,
    action: item.pricePoisa !== before.pricePoisa ? "menu.price.update" : "menu.update",
    entityType: "MenuItem",
    entityId: id,
    before,
    after: item,
    meta: item.pricePoisa !== before.pricePoisa ? { pricePoisa: { from: before.pricePoisa, to: item.pricePoisa } } : undefined,
    ip,
  });
  return item;
}

export async function setItemAvailability(id: string, available: boolean, actorUserId: string | null, ip?: string) {
  const item = await prisma.menuItem.update({ where: { id }, data: { available } });
  await writeAudit({ actorUserId, action: available ? "menu.enable" : "menu.disable", entityType: "MenuItem", entityId: id, after: item, ip });
  return item;
}

export async function setItemFeatured(id: string, featured: boolean, actorUserId: string | null, ip?: string) {
  const item = await prisma.menuItem.update({ where: { id }, data: { featured } });
  await writeAudit({ actorUserId, action: "menu.feature", entityType: "MenuItem", entityId: id, after: item, ip });
  return item;
}

export async function archiveMenuItem(id: string, actorUserId: string | null, ip?: string) {
  const before = await prisma.menuItem.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND", "Menu item not found.");
  const openOrders = await prisma.orderItem.count({
    where: { menuItemId: id, order: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
  });
  if (openOrders > 0) {
    throw new AppError("CONFLICT", `${openOrders} line(s) are still on open orders. Mark the item unavailable instead.`);
  }
  const item = await prisma.menuItem.update({ where: { id }, data: { archivedAt: new Date(), available: false, featured: false } });
  await writeAudit({ actorUserId, action: "menu.archive", entityType: "MenuItem", entityId: id, before, after: item, ip });
  return item;
}

export async function restoreMenuItem(id: string, actorUserId: string | null, ip?: string) {
  const item = await prisma.menuItem.update({ where: { id }, data: { archivedAt: null, available: true } });
  await writeAudit({ actorUserId, action: "menu.restore", entityType: "MenuItem", entityId: id, after: item, ip });
  return item;
}

export async function upsertCustomizationGroup(
  menuItemId: string,
  input: {
    id?: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    sortOrder: number;
    options: { id?: string; name: string; priceDeltaPoisa: number; available: boolean; sortOrder: number }[];
  },
  actorUserId: string | null,
  ip?: string,
) {
  if (input.minSelect > input.maxSelect) {
    throw new AppError("VALIDATION", "Minimum selections cannot exceed the maximum.");
  }
  const item = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
  if (!item || item.archivedAt) throw new AppError("NOT_FOUND", "Menu item not found.");

  return prisma.$transaction(async (tx) => {
    const group = input.id
      ? await tx.menuItemCustomizationGroup.update({
          where: { id: input.id },
          data: { name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder },
        })
      : await tx.menuItemCustomizationGroup.create({
          data: { menuItemId, name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder },
        });

    const keep = new Set(input.options.filter((option) => option.id).map((option) => option.id as string));
    const existing = await tx.menuItemCustomizationOption.findMany({ where: { groupId: group.id } });
    for (const stale of existing) {
      if (!keep.has(stale.id)) await tx.menuItemCustomizationOption.delete({ where: { id: stale.id } });
    }
    for (const option of input.options) {
      if (option.id) {
        await tx.menuItemCustomizationOption.update({
          where: { id: option.id },
          data: { name: option.name, priceDeltaPoisa: option.priceDeltaPoisa, available: option.available, sortOrder: option.sortOrder },
        });
      } else {
        await tx.menuItemCustomizationOption.create({
          data: { groupId: group.id, name: option.name, priceDeltaPoisa: option.priceDeltaPoisa, available: option.available, sortOrder: option.sortOrder },
        });
      }
    }
    await writeAudit({
      db: tx,
      actorUserId,
      action: "menu.customization.upsert",
      entityType: "MenuItemCustomizationGroup",
      entityId: group.id,
      // The option prices are the point of this record: an add-on delta is a
      // charge the guest pays, so the trail has to show what it was set to.
      after: {
        name: group.name,
        optionCount: input.options.length,
        options: input.options.map((option) => ({ name: option.name, priceDeltaPoisa: option.priceDeltaPoisa })),
      },
      ip,
    });
    return tx.menuItemCustomizationGroup.findUniqueOrThrow({
      where: { id: group.id },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
  });
}

export async function deleteCustomizationGroup(id: string, actorUserId: string | null, ip?: string) {
  const group = await prisma.menuItemCustomizationGroup.delete({ where: { id } });
  await writeAudit({ actorUserId, action: "menu.customization.delete", entityType: "MenuItemCustomizationGroup", entityId: id, before: group, ip });
  return group;
}
