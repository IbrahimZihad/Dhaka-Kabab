import { PrismaClient } from "@prisma/client";

import "./load-env";

/**
 * Read-only window onto the development database.
 *
 * The suite needs three things the browser can never see: a table's ordering
 * token (the QR payload is a random 16-byte string), the server's own figure for
 * an order it has just priced, and the menu facts a page claims to render. It
 * takes none of them as literals — every one is looked up at run time, so a reseed
 * with different ids, prices or labels does not edit a single spec.
 *
 * Nothing here writes. Demo orders, bills and payments are history and stay that
 * way; the only rows the suite creates are its own, marked with a run tag.
 */

let client: PrismaClient | undefined;

export function db(): PrismaClient {
  if (!client) client = new PrismaClient();
  return client;
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = undefined;
  if (current) await current.$disconnect();
}

export async function readSettings() {
  const settings = await db().restaurantSettings.findUnique({ where: { id: "default" } });
  if (!settings) throw new Error("restaurant_settings row 'default' is missing — the database is not seeded.");
  return settings;
}

export async function readActiveCategories() {
  return db().menuCategory.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });
}

/** Every published, available dish — what the menu page is meant to list. */
export async function readPublicItems() {
  return db().menuItem.findMany({
    where: { available: true, archivedAt: null, category: { isActive: true, archivedAt: null } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, pricePoisa: true, category: { select: { name: true, slug: true } } },
  });
}

/** A dish the menu page offers as a one-tap add: it has no customisation groups at all. */
export async function readQuickAddItem() {
  const item = await db().menuItem.findFirst({
    where: {
      available: true,
      archivedAt: null,
      category: { isActive: true, archivedAt: null },
      customizationGroups: { none: {} },
    },
    orderBy: [{ pricePoisa: "desc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, pricePoisa: true },
  });
  if (!item) throw new Error("No dish without customisation options — the one-tap add cannot be exercised.");
  return item;
}

export type UiGroup = {
  id: string;
  name: string;
  /** The customizer refuses to add the dish until at least this many are chosen. */
  minimum: number;
  /** The customizer refuses to add the dish when a required group is untouched. */
  blocking: boolean;
  /** `maxSelect` of 1 or less renders radios; anything above renders checkboxes. */
  single: boolean;
  options: { id: string; name: string; priceDeltaPoisa: number }[];
};

export type UiItem = {
  id: string;
  name: string;
  slug: string;
  pricePoisa: number;
  groups: UiGroup[];
};

function toUiItem(item: {
  id: string;
  name: string;
  slug: string;
  pricePoisa: number;
  customizationGroups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    options: { id: string; name: string; priceDeltaPoisa: number }[];
  }[];
}): UiItem {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    pricePoisa: item.pricePoisa,
    groups: item.customizationGroups.map((group) => ({
      id: group.id,
      name: group.name,
      minimum: group.required ? Math.max(1, group.minSelect) : group.minSelect,
      blocking: group.required || group.minSelect > 0,
      single: group.maxSelect <= 1,
      options: group.options,
    })),
  };
}

/**
 * A dish the guest can actually add on the detail page *and* that carries a paid
 * extra — the pair of facts the QR ordering journey needs. "Can actually add"
 * means every blocking group still has an available option, because the page
 * refuses an incomplete required choice.
 */
export async function readItemWithPaidAddon(): Promise<UiItem> {
  const candidates = await db().menuItem.findMany({
    where: {
      available: true,
      archivedAt: null,
      category: { isActive: true, archivedAt: null },
      customizationGroups: {
        some: { options: { some: { available: true, priceDeltaPoisa: { gt: 0 } } } },
      },
    },
    include: {
      customizationGroups: {
        where: { options: { some: { available: true } } },
        include: {
          options: { where: { available: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ pricePoisa: "asc" }, { name: "asc" }],
    take: 40,
  });

  const usable = candidates
    .map(toUiItem)
    .filter((item) => item.groups.every((group) => group.options.length >= group.minimum))
    .filter((item) => item.groups.some((group) => group.options.some((option) => option.priceDeltaPoisa > 0)))
    .sort((a, b) => a.groups.length - b.groups.length);

  const found = usable[0];
  if (!found) throw new Error("No available dish offers a paid extra with a satisfiable choice.");
  return found;
}

/**
 * A table a guest may be seated at. A table that already has an active visit is
 * preferred: joining one only adds a device to a session that is already open, so
 * the journey does not change the floor's state on its way past.
 */
export async function readTableForOrdering(): Promise<{ label: string; publicToken: string }> {
  const tables = await db().restaurantTable.findMany({
    where: { isEnabled: true, status: { notIn: ["DISABLED", "CLEANING"] } },
    include: { sessions: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 } },
    orderBy: { number: "asc" },
  });
  const chosen = tables.find((table) => table.sessions.length > 0) ?? tables[0];
  if (!chosen) throw new Error("No enabled table is open for ordering.");
  return { label: chosen.label, publicToken: chosen.publicToken };
}

/**
 * The sum of seats the room could ever combine — the size of a "book the whole room".
 * Mirrors what the booking allocator actually seats (`chooseTables` skips DISABLED and
 * CLEANING); counting a table stuck for clearing would have the test book seats the
 * restaurant then refuses, and the failure would look like a bug in the grid.
 */
export async function readTotalSeats(): Promise<number> {
  const aggregate = await db().restaurantTable.aggregate({
    where: { isEnabled: true, status: { notIn: ["DISABLED", "CLEANING"] } },
    _sum: { capacity: true },
  });
  const seats = aggregate._sum.capacity ?? 0;
  if (seats < 1) throw new Error("No enabled tables — the reservation journey cannot be exercised.");
  return seats;
}

export async function readOrderByNumber(orderNumber: string) {
  const order = await db().order.findUnique({
    where: { orderNumber },
    include: {
      items: {
        select: { id: true, nameSnapshot: true, quantity: true, unitPricePoisa: true, lineTotalPoisa: true },
        orderBy: { id: "asc" },
      },
      table: { select: { label: true } },
      session: { select: { id: true, code: true } },
    },
  });
  if (!order) throw new Error(`Order ${orderNumber} was never written — the journey did not place an order.`);
  return order;
}

export function countOrdersSince(since: Date): Promise<number> {
  return db().order.count({ where: { createdAt: { gte: since } } });
}

/** Marks the guest's own contact name so the row the suite created is findable. */
export function findTakeawayOrderByName(name: string) {
  return db().order.findFirst({
    where: { type: "TAKEAWAY", contactName: name },
    include: {
      items: {
        select: { id: true, nameSnapshot: true, quantity: true, unitPricePoisa: true, lineTotalPoisa: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function readReservationByCode(code: string) {
  const reservation = await db().reservation.findUnique({
    where: { code },
    include: { tables: { include: { table: { select: { label: true } } } } },
  });
  if (!reservation) throw new Error(`Booking ${code} is not in the database.`);
  return reservation;
}

/**
 * How many bookings a run-tagged name left behind. Used to prove a refused request
 * wrote nothing, since a refusal has no code to look up.
 */
export function countReservationsByName(name: string): Promise<number> {
  return db().reservation.count({ where: { customerName: name } });
}

export type ChatDish = { name: string; pricePoisa: number };

/**
 * A dish the guest can ask the assistant about by name and get one answer about.
 *
 * The assistant searches each dish's name, category, description, ingredients and
 * allergens for the words in the question, so a name whose words also describe
 * other dishes would bring back a list. This picks an available dish whose every
 * name word belongs to it alone, and whose name does not read as an allergen
 * question — the caller passes that pattern, because which words a customer uses
 * healthily is the widget's business, not this file's.
 */
export async function readChatDish(nameMustNotMatch: RegExp): Promise<ChatDish> {
  const items = await db().menuItem.findMany({
    where: { archivedAt: null },
    orderBy: [{ pricePoisa: "desc" }, { name: "asc" }],
    select: {
      name: true,
      pricePoisa: true,
      available: true,
      description: true,
      ingredients: true,
      allergens: true,
      category: { select: { name: true } },
    },
  });

  const haystack = (item: (typeof items)[number]) =>
    `${item.name} ${item.category.name} ${item.description ?? ""} ${item.ingredients ?? ""} ${item.allergens ?? ""}`.toLowerCase();
  const words = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);

  const dish = items.find((item) => {
    const name = words(item.name);
    if (!item.available || name.length === 0 || nameMustNotMatch.test(item.name)) return false;
    return name.every((word) => items.filter((other) => haystack(other).includes(word)).length === 1);
  });
  if (!dish) throw new Error("No dish has a name the assistant can answer about on its own — every menu word is shared.");
  return { name: dish.name, pricePoisa: dish.pricePoisa };
}
