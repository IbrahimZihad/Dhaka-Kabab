/**
 * Demo seed for local development and previews.
 *
 *   npm run db:seed
 *
 * Everything written here is either configuration a restaurant would set itself
 * (`/admin/settings`) or rows flagged `isDemo = true`, so a real deployment can
 * tell seeded history from real transactions. Re-running is safe: menu, floor
 * tables and settings are upserted without clobbering edits, and transactional
 * demo data is only generated when none exists yet.
 *
 * No account is created unless SEED_DEMO_PASSWORD is supplied and passes the
 * same strength rules the signup form uses. There is no default password here,
 * and a production database is refused unless SEED_ALLOW_PRODUCTION=1.
 */
import { PrismaClient, type OrderStatus, type PaymentMethod, type Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomShortCode, randomToken, slugify } from "../src/lib/ids";
import { computeTotals, lineTotal } from "../src/lib/billing-math";
import { nextDocumentNumber } from "../src/server/services/counters";
import { todayKey, wallToUtc } from "../src/lib/time";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEZONE = "Asia/Dhaka";

/** Minimal `.env` reader — the same rules `scripts/db-setup.mjs` uses. Never logs values. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^"|"$/g, "");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}
loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".env.local"));

const prisma = new PrismaClient();

/** Deterministic generator so a reseed produces the same demo spread, not a new one. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const intIn = (r: () => number, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));

/**
 * A wall-clock time in the restaurant's timezone as a real UTC instant. Seeding
 * a "8 pm dinner" has to mean 8 pm in Dhaka no matter how the machine running
 * this script is configured.
 */
function dhakaDay(offsetDays: number, hour: number, minute = 0): Date {
  const day = new Date(`${todayKey(TIMEZONE)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return wallToUtc(day.toISOString().slice(0, 10), label, TIMEZONE);
}

// --- configuration ----------------------------------------------------------

const DEMO_SETTINGS = {
  name: "Dhaka Kabab (demo)",
  addressLine1: "Demo address — replace in /admin/settings",
  addressLine2: null,
  city: "Dhaka",
  phonePrimary: "+880 1700 000000",
  emailPublic: "demo@example.invalid",
  // A kabab house is judged on its hours; this is a placeholder, not a claim
  // about any real restaurant.
  openingHours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "12:00", closes: "23:30" }],
  serviceChargeBps: 1000,
  vatBps: 500,
  vatOnServiceCharge: true,
  roundingStepPoisa: 100,
  deliveryFeePoisa: 6000,
  allowDelivery: true,
  receiptFooter: "Demo receipt — configure your own in /admin/settings.",
};

async function seedSettings(): Promise<void> {
  const existing = await prisma.restaurantSettings.findUnique({ where: { id: "default" } });
  // Only fill what the operator has not set, so a reseed never overwrites real
  // configuration or an already-customised restaurant identity.
  const patch: Prisma.RestaurantSettingsUpdateInput = {};
  const target = existing ?? null;
  const setIf = <K extends keyof typeof DEMO_SETTINGS>(key: K, current: unknown) => {
    const next = DEMO_SETTINGS[key];
    if (next === null || next === undefined) return;
    const empty = current === null || current === undefined || current === "" || (Array.isArray(current) && current.length === 0);
    if (empty) (patch as Record<string, unknown>)[key] = next;
  };
  for (const key of Object.keys(DEMO_SETTINGS) as (keyof typeof DEMO_SETTINGS)[]) {
    setIf(key, target?.[key as keyof typeof DEMO_SETTINGS]);
  }
  if (existing) {
    if (Object.keys(patch).length > 0) await prisma.restaurantSettings.update({ where: { id: "default" }, data: patch });
  } else {
    await prisma.restaurantSettings.create({ data: { id: "default", ...DEMO_SETTINGS } as Prisma.RestaurantSettingsCreateInput });
  }
  console.log(`  settings: ${existing ? (Object.keys(patch).length ? "demo defaults filled" : "left as configured") : "created"}`);
}

// --- menu -------------------------------------------------------------------

type DemoItem = {
  name: string;
  price: number;
  description: string;
  prep: number;
  spicy: number;
  featured?: boolean;
  serves?: string;
  allergens?: string;
  ingredients?: string;
  groups?: { name: string; required?: boolean; max?: number; options: [string, number][] }[];
};

const MENU: Record<string, { description: string; items: DemoItem[] }> = {
  "Kababs off the fire": {
    description: "Charcoal-grilled, marinated overnight.",
    items: [
      { name: "Chicken Tikka Boti", price: 38000, description: "Boneless thigh in yoghurt and mustard oil.", prep: 14, spicy: 2, featured: true, serves: "Serves 2", allergens: "Dairy", ingredients: "Chicken thigh, yoghurt, mustard oil, ginger, chilli",
        groups: [
          { name: "Portion", required: true, options: [["Regular (8 pcs)", 0], ["Large (12 pcs)", 18000]] },
          { name: "Fire", options: [["Mild", 0], ["Medium", 0], ["Hot", 0]] },
        ] },
      { name: "Seekh Kabab", price: 32000, description: "Minced lamb on skewers with green chilli.", prep: 15, spicy: 3, serves: "4 skewers", allergens: "Dairy",
        groups: [{ name: "Add bread", options: [["No", 0], ["Butter naan", 6000], ["Rumali roti", 8000]] }] },
      { name: "Mutton Rezala Kabab", price: 62000, description: "Slow-cooked lamb shoulder, yoghurt gravy.", prep: 22, spicy: 2, featured: true, serves: "Serves 2" },
      { name: "Shami Kabab", price: 35000, description: "Chana dal and minced beef patty, breaded.", prep: 12, spicy: 1, allergens: "Gluten, Egg" },
      { name: "Jhali Kabab", price: 42000, description: "Cage-grilled minced chicken with onion capsicum.", prep: 16, spicy: 2 },
      { name: "Tandoori Chicken (half)", price: 55000, description: "Whole bird cut, served with salad.", prep: 25, spicy: 2, serves: "Serves 2-3",
        groups: [{ name: "Serving", options: [["With rice", 12000], ["Plain", 0], ["With salad", 4000]] }] },
    ],
  },
  "Biryani & Pulao": {
    description: "Aged basmati, kewra and a sealed pot.",
    items: [
      { name: "Kachchi Biryani", price: 65000, description: "Marinated raw lamb layered over rice, dum-cooked.", prep: 30, spicy: 2, featured: true, serves: "Serves 1-2", allergens: "Dairy",
        groups: [{ name: "Protein", required: true, options: [["Lamb (default)", 0], ["Extra lamb", 22000], ["Double lamb", 40000]] }] },
      { name: "Mutton Biryani", price: 48000, description: "Pre-cooked lamb, dark gravy on the side.", prep: 20, spicy: 2, serves: "Serves 1" },
      { name: "Chicken Biryani", price: 38000, description: "The everyday plate.", prep: 18, spicy: 2, featured: true },
      { name: "Morow Pulao", price: 30000, description: "Ghee pulao with chicken and raisin.", prep: 16, spicy: 0, allergens: "Dairy" },
      { name: "Tark Pulao", price: 22000, description: "Onion-forward pulao, no meat.", prep: 14, spicy: 0, allergens: "Dairy" },
    ],
  },
  "Rice & Curry": {
    description: "Plates built for sharing.",
    items: [
      { name: "Beef Rezala", price: 42000, description: "Whole-spice yoghurt curry.", prep: 12, spicy: 1 },
      { name: "Chicken Roast", price: 35000, description: "Thick gravy, potatoes included.", prep: 12, spicy: 2 },
      { name: "Dal Makhani", price: 18000, description: "Black lentils, overnight on low heat.", prep: 8, spicy: 0, allergens: "Dairy" },
      { name: "Mix Vegetable", price: 20000, description: "Seasonal vegetables, light masala.", prep: 8, spicy: 0 },
    ],
  },
  "Breads": {
    description: "From the tandoor, to order.",
    items: [
      { name: "Naan", price: 4000, description: "Plain, blistered.", prep: 4, spicy: 0 },
      { name: "Butter Naan", price: 6000, description: "Brushed with ghee.", prep: 4, spicy: 0, allergens: "Dairy" },
      { name: "Kulcha", price: 7000, description: "Stuffed onion and coriander.", prep: 6, spicy: 1, allergens: "Gluten" },
      { name: "Porota", price: 5000, description: "Flaky, hand-rolled.", prep: 5, spicy: 0, allergens: "Gluten" },
    ],
  },
  "Sides & Salad": {
    description: "The things that make the plate work.",
    items: [
      { name: "Borhani", price: 9000, description: "Spiced yoghurt drink.", prep: 2, spicy: 0, allergens: "Dairy" },
      { name: "Green Salad", price: 8000, description: "Cucumber, tomato, onion, lemon.", prep: 2, spicy: 0 },
      { name: "Raita", price: 9000, description: "Cucumber and mint in yoghurt.", prep: 2, spicy: 0, allergens: "Dairy" },
      { name: "Mixed Pickle", price: 6000, description: "Mustard oil, raw mango.", prep: 1, spicy: 3 },
    ],
  },
  "Sweet & Cold": {
    description: "Finish the meal.",
    items: [
      { name: "Firni", price: 12000, description: "Rice pudding in a clay pot.", prep: 1, spicy: 0, featured: true, allergens: "Dairy, Nuts" },
      { name: "Roshgolay", price: 10000, description: "Three pieces in light syrup.", prep: 1, spicy: 0, allergens: "Dairy, Gluten" },
      { name: "Cold Coffee", price: 18000, description: "Blended, no ice cream.", prep: 4, spicy: 0, allergens: "Dairy" },
      { name: "Lemon Mint Soda", price: 12000, description: "Fresh lime, soda, mint.", prep: 3, spicy: 0 },
    ],
  },
};

async function seedMenu(): Promise<void> {
  let itemOrder = 0;
  let created = 0;
  let pruned = 0;
  const categoryNames = Object.keys(MENU);
  for (let index = 0; index < categoryNames.length; index++) {
    const categoryName = categoryNames[index];
    const category = MENU[categoryName];
    const categorySlug = slugify(categoryName);
    const categoryRow = await prisma.menuCategory.upsert({
      where: { slug: categorySlug },
      update: { sortOrder: index * 10, description: category.description },
      create: { name: categoryName, slug: categorySlug, description: category.description, sortOrder: index * 10 },
    });
    for (const item of category.items) {
      const slug = slugify(item.name);
      const row = await prisma.menuItem.upsert({
        where: { slug },
        update: {
          pricePoisa: item.price,
          categoryId: categoryRow.id,
          description: item.description,
          prepMinutes: item.prep,
          spicyLevel: item.spicy,
          featured: item.featured ?? false,
          available: true,
          archivedAt: null,
        },
        create: {
          name: item.name,
          slug,
          description: item.description,
          categoryId: categoryRow.id,
          pricePoisa: item.price,
          prepMinutes: item.prep,
          spicyLevel: item.spicy,
          featured: item.featured ?? false,
          servesInfo: item.serves,
          allergens: item.allergens,
          ingredients: item.ingredients,
          sortOrder: itemOrder++,
        },
      });
      created += 1;
      if (!item.groups) continue;
      for (const [groupIndex, group] of item.groups.entries()) {
        const existingGroup = await prisma.menuItemCustomizationGroup.findFirst({
          where: { menuItemId: row.id, name: group.name },
        });
        const groupRow =
          existingGroup ??
          (await prisma.menuItemCustomizationGroup.create({
            data: {
              menuItemId: row.id,
              name: group.name,
              required: group.required ?? false,
              maxSelect: group.max ?? 1,
              minSelect: group.required ? 1 : 0,
              sortOrder: groupIndex,
            },
          }));
        for (const [optionIndex, [optionName, delta]] of group.options.entries()) {
          const existingOption = await prisma.menuItemCustomizationOption.findFirst({
            where: { groupId: groupRow.id, name: optionName },
          });
          if (existingOption) {
            await prisma.menuItemCustomizationOption.update({ where: { id: existingOption.id }, data: { priceDeltaPoisa: delta } });
          } else {
            await prisma.menuItemCustomizationOption.create({
              data: { groupId: groupRow.id, name: optionName, priceDeltaPoisa: delta, sortOrder: optionIndex },
            });
          }
        }
        // An option from an earlier version of this menu survives the upsert, and a
        // stale paid add-on is a real pricing bug on the ordering screen. Past orders
        // are unaffected: they carry their own `optionsSnapshot`.
        const declared = new Set(group.options.map(([name]) => name));
        for (const option of await prisma.menuItemCustomizationOption.findMany({
          where: { groupId: groupRow.id },
          select: { id: true, name: true },
        })) {
          if (declared.has(option.name)) continue;
          await prisma.menuItemCustomizationOption.delete({ where: { id: option.id } });
          pruned += 1;
        }
      }
    }
  }
  console.log(
    `  menu: ${created} items in ${categoryNames.length} categories${pruned > 0 ? `, ${pruned} option${pruned === 1 ? "" : "s"} removed that this seed no longer defines` : ""}`,
  );
}

// --- floor ------------------------------------------------------------------

const FLOOR: { label: string; capacity: number; section: string }[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ label: `T${i + 1}`, capacity: i % 2 === 0 ? 2 : 4, section: "Main Hall" })),
  ...Array.from({ length: 4 }, (_, i) => ({ label: `T${i + 7}`, capacity: 6, section: "Family Lounge" })),
  ...Array.from({ length: 2 }, (_, i) => ({ label: `T${i + 11}`, capacity: 8, section: "Roof Terrace" })),
];

async function seedTables(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [index, table] of FLOOR.entries()) {
    const existing = await prisma.restaurantTable.findUnique({ where: { label: table.label } });
    const row = existing
      ? await prisma.restaurantTable.update({
          where: { id: existing.id },
          data: { capacity: existing.capacity || table.capacity, section: existing.section ?? table.section },
        })
      : await prisma.restaurantTable.create({
          data: {
            label: table.label,
            number: index + 1,
            publicToken: randomToken(16),
            capacity: table.capacity,
            section: table.section,
          },
        });
    ids[table.label] = row.id;
  }
  console.log(`  floor: ${FLOOR.length} tables across ${new Set(FLOOR.map((t) => t.section)).size} sections`);
  return ids;
}

// --- transactional demo history --------------------------------------------

const GUEST_NAMES = [
  "Nusrat Jahan", "Rafiqul Islam", "Tania Akter", "Mahmudul Hasan", "Sadia Rahman",
  "Imran Kabir", "Farhana Yeasmin", "Shakib Al Amin", "Rezwana Chowdhury", "Tanvir Ahmed",
];

async function alreadySeeded(): Promise<boolean> {
  const demoOrders = await prisma.order.count({ where: { isDemo: true } });
  return demoOrders > 0;
}

type Settings = Awaited<ReturnType<typeof prisma.restaurantSettings.findUnique>>;
type MenuLookup = Map<string, { id: string; pricePoisa: number; name: string }>;

/** The lifecycle the app enforces; seeded events walk the same path. */
const ORDER_FLOW = ["PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED"] as const;
type FlowStatus = (typeof ORDER_FLOW)[number];
const MINUTES_AT: Record<FlowStatus, number> = {
  PENDING: 0,
  CONFIRMED: 1,
  PREPARING: 5,
  READY: 24,
  SERVED: 33,
  COMPLETED: 62,
};

async function buildOrder(
  settings: NonNullable<Settings>,
  tableIds: Record<string, string>,
  opts: {
    at: Date;
    type: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
    table?: string;
    sessionId?: string;
    status?: OrderStatus;
    items: { name: string; qty: number; options?: { name: string; priceDeltaPoisa: number }[] }[];
    menuByName: MenuLookup;
    r: () => number;
    discountPoisa?: number;
  },
) {
  const target: OrderStatus = opts.status ?? "COMPLETED";
  const reached = ORDER_FLOW.slice(0, ORDER_FLOW.indexOf(target as FlowStatus) + 1);
  const lines = opts.items.map((line) => {
    const menu = opts.menuByName.get(line.name);
    if (!menu) throw new Error(`Seed references unknown menu item "${line.name}".`);
    const deltas = (line.options ?? []).reduce((sum, option) => sum + option.priceDeltaPoisa, 0);
    const unit = menu.pricePoisa + deltas;
    return {
      menuItemId: menu.id,
      nameSnapshot: menu.name,
      unitPricePoisa: unit,
      quantity: line.qty,
      lineTotalPoisa: lineTotal(unit, line.qty),
      optionsSnapshot: line.options ?? [],
    };
  });
  const totals = computeTotals({
    lines,
    discountPoisa: opts.discountPoisa ?? 0,
    serviceChargeBps: opts.type === "DINE_IN" ? settings.serviceChargeBps : 0,
    vatBps: settings.vatBps,
    vatOnServiceCharge: settings.vatOnServiceCharge,
    deliveryFeePoisa: opts.type === "DELIVERY" ? settings.deliveryFeePoisa : 0,
    roundingStepPoisa: settings.roundingStepPoisa,
  });
  const at = (status: FlowStatus) => new Date(opts.at.getTime() + MINUTES_AT[status] * 60_000);
  const orderNumber = await nextDocumentNumber("order", { timeZone: TIMEZONE, at: opts.at });
  const paid = opts.type !== "DINE_IN";
  const order = await prisma.order.create({
    data: {
      orderNumber,
      publicToken: randomToken(12),
      type: opts.type,
      status: target,
      // A dine-in visit is settled on the bill, not on the order.
      paymentStatus: paid ? "PAID" : "UNPAID",
      tableId: opts.table ? tableIds[opts.table] : null,
      sessionId: opts.sessionId ?? null,
      subtotalPoisa: totals.subtotalPoisa,
      discountPoisa: totals.discountPoisa,
      serviceChargePoisa: totals.serviceChargePoisa,
      vatPoisa: totals.vatPoisa,
      deliveryFeePoisa: totals.deliveryFeePoisa,
      totalPoisa: totals.totalPoisa,
      paidPoisa: paid ? totals.totalPoisa : 0,
      contactName: pick(opts.r, GUEST_NAMES),
      contactPhone: `017${String(intIn(opts.r, 10000000, 99999999))}`,
      deliveryAddress: opts.type === "DELIVERY" ? "House 12, Road 5 (demo address)" : null,
      specialInstructions: opts.r() > 0.75 ? "Less chilli, please." : null,
      createdAt: opts.at,
      updatedAt: at(reached[reached.length - 1]),
      confirmedAt: reached.includes("CONFIRMED") ? at("CONFIRMED") : null,
      preparingAt: reached.includes("PREPARING") ? at("PREPARING") : null,
      readyAt: reached.includes("READY") ? at("READY") : null,
      servedAt: reached.includes("SERVED") ? at("SERVED") : null,
      completedAt: reached.includes("COMPLETED") ? at("COMPLETED") : null,
      isDemo: true,
      items: { create: lines },
      statusEvents: {
        create: reached.map((status, index) => ({
          fromStatus: index === 0 ? null : reached[index - 1],
          toStatus: status,
          createdAt: at(status),
        })),
      },
    },
    include: { items: true },
  });
  return { order, totals };
}

type Round = Awaited<ReturnType<typeof buildOrder>>;

async function seedHistory(tableIds: Record<string, string>): Promise<void> {
  if (await alreadySeeded()) {
    console.log("  history: demo transactions already present, left untouched");
    return;
  }
  const settings = await prisma.restaurantSettings.findUnique({ where: { id: "default" } });
  if (!settings) throw new Error("Settings row missing before history seed.");

  const menuRows = await prisma.menuItem.findMany({ where: { archivedAt: null } });
  const menuByName: MenuLookup = new Map(menuRows.map((row) => [row.name, { id: row.id, pricePoisa: row.pricePoisa, name: row.name }]));
  const r = rng(20261028);

  let orders = 0;
  let bills = 0;
  let payments = 0;
  const labels = Object.keys(tableIds);

  const settleVisit = async (sessionId: string, rounds: Round[], at: Date) => {
    const allLines = rounds.flatMap((round) => round.order.items.map((item) => ({ lineTotalPoisa: item.lineTotalPoisa })));
    const totals = computeTotals({
      lines: allLines,
      serviceChargeBps: settings.serviceChargeBps,
      vatBps: settings.vatBps,
      vatOnServiceCharge: settings.vatOnServiceCharge,
      roundingStepPoisa: settings.roundingStepPoisa,
    });
    const bill = await prisma.bill.create({
      data: {
        number: await nextDocumentNumber("bill", { timeZone: TIMEZONE, at }),
        status: "SETTLED",
        sessionId,
        subtotalPoisa: totals.subtotalPoisa,
        serviceChargePoisa: totals.serviceChargePoisa,
        vatPoisa: totals.vatPoisa,
        totalPoisa: totals.totalPoisa,
        paidPoisa: totals.totalPoisa,
        finalizedAt: at,
        settledAt: at,
        // The configuration the totals were struck under, kept as audit evidence.
        snapshot: { seeded: true, serviceChargeBps: settings.serviceChargeBps, vatBps: settings.vatBps, roundingStepPoisa: settings.roundingStepPoisa },
        isDemo: true,
        items: {
          create: rounds.flatMap((round) =>
            round.order.items.map((item) => ({
              orderItemId: item.id,
              orderNumber: round.order.orderNumber,
              description: item.nameSnapshot,
              optionsSnapshot: item.optionsSnapshot as Prisma.InputJsonValue,
              unitPricePoisa: item.unitPricePoisa,
              quantity: item.quantity,
              lineTotalPoisa: item.lineTotalPoisa,
            })),
          ),
        },
        orders: { create: rounds.map((round) => ({ orderId: round.order.id })) },
      },
    });
    bills += 1;
    const method = pick(r, ["CASH", "CARD", "MOBILE_BANKING"]) as PaymentMethod;
    await prisma.payment.create({
      data: {
        reference: randomToken(10),
        billId: bill.id,
        method,
        status: "SUCCEEDED",
        amountPoisa: totals.totalPoisa,
        provider: "counter",
        verifiedAt: at,
        isDemo: true,
        createdAt: at,
        events: {
          create: {
            eventKey: `seed:${bill.id}`,
            kind: "counter.collection",
            payload: { method, amountPoisa: totals.totalPoisa },
            createdAt: at,
          },
        },
      },
    });
    payments += 1;
    await prisma.order.updateMany({ where: { id: { in: rounds.map((round) => round.order.id) } }, data: { paymentStatus: "PAID" } });
  };

  // Two weeks of closed service, so the reports and dashboard have a real shape.
  for (let day = -14; day <= -1; day++) {
    const covers = intIn(r, 4, 8);
    const usedTables = [...labels].sort(() => r() - 0.5).slice(0, covers);
    for (const table of usedTables) {
      const openedAt = dhakaDay(day, intIn(r, 13, 21), pick(r, [0, 15, 30, 45]));
      const capacity = FLOOR.find((row) => row.label === table)?.capacity ?? 4;
      const closedAt = new Date(openedAt.getTime() + intIn(r, 60, 120) * 60_000);
      const session = await prisma.tableSession.create({
        data: {
          code: randomShortCode(6),
          tableId: tableIds[table],
          status: "CLOSED",
          guestCount: intIn(r, 2, capacity),
          openedAt,
          closedAt,
          closeReason: "Guest settled the bill at the counter.",
          notes: r() > 0.8 ? "Window seat requested." : null,
        },
      });
      const rounds = [
        await buildOrder(settings, tableIds, {
          at: openedAt,
          type: "DINE_IN",
          table,
          sessionId: session.id,
          menuByName,
          r,
          items: [
            { name: pick(r, ["Chicken Tikka Boti", "Seekh Kabab", "Jhali Kabab"]), qty: intIn(r, 1, 2), options: [{ name: "Regular (8 pcs)", priceDeltaPoisa: 0 }] },
            { name: pick(r, ["Chicken Biryani", "Mutton Biryani", "Kachchi Biryani"]), qty: intIn(r, 1, 3) },
            { name: "Butter Naan", qty: intIn(r, 2, 4) },
          ],
        }),
      ];
      if (r() > 0.45) {
        rounds.push(
          await buildOrder(settings, tableIds, {
            at: new Date(openedAt.getTime() + 20 * 60_000),
            type: "DINE_IN",
            table,
            sessionId: session.id,
            menuByName,
            r,
            items: [
              { name: pick(r, ["Dal Makhani", "Mix Vegetable"]), qty: 1 },
              { name: pick(r, ["Borhani", "Lemon Mint Soda", "Cold Coffee"]), qty: intIn(r, 1, 3) },
            ],
          }),
        );
      }
      orders += rounds.length;
      await settleVisit(session.id, rounds, closedAt);
    }

    for (let counterOrder = 0; counterOrder < intIn(r, 2, 4); counterOrder++) {
      const at = dhakaDay(day, intIn(r, 13, 22), pick(r, [5, 25, 40]));
      const type = counterOrder % 2 === 0 ? ("TAKEAWAY" as const) : ("DELIVERY" as const);
      const order = await buildOrder(settings, tableIds, {
        at,
        type,
        menuByName,
        r,
        items: [
          { name: pick(r, ["Chicken Biryani", "Mutton Biryani"]), qty: intIn(r, 1, 4) },
          { name: pick(r, ["Shami Kabab", "Tandoori Chicken (half)"]), qty: 1 },
          { name: "Raita", qty: intIn(r, 1, 2) },
        ],
      });
      orders += 1;
      await prisma.payment.create({
        data: {
          reference: randomToken(10),
          orderId: order.order.id,
          method: type === "DELIVERY" ? "CASH" : "MOBILE_BANKING",
          status: "SUCCEEDED",
          amountPoisa: order.totals.totalPoisa,
          provider: type === "DELIVERY" ? "counter" : "simulated",
          verifiedAt: at,
          isDemo: true,
          createdAt: at,
        },
      });
      payments += 1;
    }
  }

  // Open service right now: the floor and kitchen screens should never be empty
  // when somebody opens them for the first time. These are anchored to the
  // actual clock rather than a fixed dinner hour, so a table is "live" whether
  // the preview is opened in the morning or at midnight.
  const startedAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const liveTables = [labels[0], labels[2]];
  for (const [index, table] of liveTables.entries()) {
    const session = await prisma.tableSession.create({
      data: {
        code: randomShortCode(6),
        tableId: tableIds[table],
        status: "ACTIVE",
        guestCount: index === 0 ? 3 : 2,
        openedAt: startedAgo(45),
        billRequestedAt: index === 0 ? startedAgo(8) : null,
        notes: index === 0 ? "Birthday — dessert on the house if asked." : null,
      },
    });
    const live = await buildOrder(settings, tableIds, {
      at: startedAgo(35 - index * 5),
      type: "DINE_IN",
      table,
      sessionId: session.id,
      status: index === 0 ? "PREPARING" : "CONFIRMED",
      menuByName,
      r,
      items:
        index === 0
          ? [
              { name: "Chicken Tikka Boti", qty: 2, options: [{ name: "Large (12 pcs)", priceDeltaPoisa: 18000 }] },
              { name: "Butter Naan", qty: 3 },
            ]
          : [{ name: "Kachchi Biryani", qty: 2 }],
    });
    orders += 1;
    await prisma.restaurantTable.update({ where: { id: tableIds[table] }, data: { status: "OCCUPIED" } });
    await prisma.bill.create({
      data: {
        number: await nextDocumentNumber("bill", { timeZone: TIMEZONE, at: startedAgo(45) }),
        status: "OPEN",
        sessionId: session.id,
        subtotalPoisa: live.totals.subtotalPoisa,
        serviceChargePoisa: live.totals.serviceChargePoisa,
        vatPoisa: live.totals.vatPoisa,
        totalPoisa: live.totals.totalPoisa,
        isDemo: true,
        items: {
          create: live.order.items.map((item) => ({
            orderItemId: item.id,
            orderNumber: live.order.orderNumber,
            description: item.nameSnapshot,
            optionsSnapshot: item.optionsSnapshot as Prisma.InputJsonValue,
            unitPricePoisa: item.unitPricePoisa,
            quantity: item.quantity,
            lineTotalPoisa: item.lineTotalPoisa,
          })),
        },
        orders: { create: [{ orderId: live.order.id }] },
      },
    });
    bills += 1;
  }

  console.log(`  history: ${orders} orders, ${bills} bills, ${payments} payments (all flagged demo)`);
}

async function seedReservations(): Promise<void> {
  const existing = await prisma.reservation.count({ where: { isDemo: true } });
  if (existing > 0) {
    console.log(`  reservations: ${existing} demo bookings already present, left untouched`);
    return;
  }
  const r = rng(777);
  const rows = [
    { day: 0, hour: 20, party: 4, status: "CONFIRMED" as const },
    { day: 1, hour: 19, party: 2, status: "CONFIRMED" as const },
    { day: 1, hour: 21, party: 6, status: "PENDING" as const },
    { day: 2, hour: 13, party: 8, status: "PENDING" as const },
    { day: 3, hour: 20, party: 3, status: "CONFIRMED" as const },
    { day: -1, hour: 20, party: 4, status: "COMPLETED" as const },
    { day: -2, hour: 19, party: 2, status: "NO_SHOW" as const },
    { day: -3, hour: 21, party: 5, status: "CANCELLED" as const },
  ];
  for (const [index, row] of rows.entries()) {
    const startsAt = dhakaDay(row.day, row.hour, 0);
    const code = await nextDocumentNumber("reservation", { timeZone: TIMEZONE, at: startsAt });
    await prisma.reservation.create({
      data: {
        code,
        publicToken: randomToken(12),
        customerName: GUEST_NAMES[index % GUEST_NAMES.length],
        phone: `017${String(intIn(r, 10000000, 99999999))}`,
        email: index % 3 === 0 ? `guest${index}@example.invalid` : null,
        partySize: row.party,
        startsAt,
        durationMinutes: 90,
        status: row.status,
        specialRequests: index % 4 === 0 ? "One high chair, please." : null,
        policyAccepted: true,
        createdVia: "WEB",
        confirmedAt: row.status === "CONFIRMED" || row.status === "COMPLETED" ? new Date(startsAt.getTime() - 3600_000) : null,
        checkedInAt: row.status === "COMPLETED" ? new Date(startsAt.getTime() + 5 * 60_000) : null,
        completedAt: row.status === "COMPLETED" ? new Date(startsAt.getTime() + 95 * 60_000) : null,
        cancelledAt: row.status === "CANCELLED" ? new Date(startsAt.getTime() - 7200_000) : null,
        cancelReason: row.status === "CANCELLED" ? "Guest phoned to cancel." : null,
        noShowAt: row.status === "NO_SHOW" ? new Date(startsAt.getTime() + 20 * 60_000) : null,
        createdAt: new Date(startsAt.getTime() - 86400_000),
        isDemo: true,
      },
    });
  }
  console.log(`  reservations: ${rows.length} demo bookings, ${rows.filter((row) => row.day >= 0).length} of them upcoming`);
}

async function seedChat(): Promise<void> {
  const existing = await prisma.chatConversation.count();
  if (existing > 0) {
    console.log(`  chat: ${existing} conversations present, leaving the inbox as-is`);
    return;
  }
  const conversations = [
    {
      question: "Do you have halal chicken and what time do you close?",
      answer: "All of our chicken is halal. The demo opening hours in Settings say 12:00 to 23:30 every day — staff can correct that in /admin/settings.",
      escalated: false,
      fallback: true,
    },
    {
      question: "I ordered 20 minutes ago and nothing moved. Where is my food?",
      answer: "I cannot see order status without a reference. Let me get a person to look at this.",
      escalated: true,
      fallback: false,
    },
  ];
  for (const [index, conversation] of conversations.entries()) {
    const startedAt = dhakaDay(-index, 20, 30 + index);
    await prisma.chatConversation.create({
      data: {
        publicToken: randomToken(12),
        locale: "en",
        fallbackOnly: conversation.fallback,
        escalatedAt: conversation.escalated ? new Date(startedAt.getTime() + 90_000) : null,
        escalationReason: conversation.escalated ? "Guest asked for a human after a delay complaint." : null,
        startedAt,
        lastActiveAt: new Date(startedAt.getTime() + 120_000),
        messageCount: 2,
        messages: {
          create: [
            { role: "USER", content: conversation.question, createdAt: startedAt },
            { role: "ASSISTANT", content: conversation.answer, usedFallback: conversation.fallback, createdAt: new Date(startedAt.getTime() + 120_000) },
          ],
        },
      },
    });
  }
  console.log(`  chat: ${conversations.length} demo conversations (1 escalated)`);
}

// --- accounts ---------------------------------------------------------------

const DEMO_ACCOUNTS = [
  { email: "owner.demo@example.invalid", name: "Demo Owner", role: "OWNER" as const },
  { email: "manager.demo@example.invalid", name: "Demo Manager", role: "MANAGER" as const },
  { email: "cashier.demo@example.invalid", name: "Demo Cashier", role: "CASHIER" as const },
  { email: "kitchen.demo@example.invalid", name: "Demo Kitchen", role: "KITCHEN" as const },
  { email: "guest.demo@example.invalid", name: "Demo Guest", role: "CUSTOMER" as const },
];

async function seedAccounts(): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD?.trim();
  if (!password) {
    console.log("  accounts: skipped (set SEED_DEMO_PASSWORD to create the demo logins)");
    return;
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`SEED_DEMO_PASSWORD was rejected: ${problem}`);
  const hash = await hashPassword(password);
  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: hash, isActive: true } });
      continue;
    }
    await prisma.user.create({ data: { email: account.email, name: account.name, role: account.role, passwordHash: hash } });
    created += 1;
  }
  console.log(`  accounts: ${created} demo logins ready (password came from SEED_DEMO_PASSWORD, never printed)`);
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    throw new Error("Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=1 only if this really is a demo environment.");
  }
  console.log("Seeding demo data (this never prints a secret):\n");
  await seedSettings();
  await seedMenu();
  const tableIds = await seedTables();
  await seedHistory(tableIds);
  await seedReservations();
  await seedChat();
  await seedAccounts();
  console.log("\nDone. Sign in as staff with `npm run admin:create`; the seed creates no password by itself.");
}

main()
  .catch((error: unknown) => {
    console.error("\nSeed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
