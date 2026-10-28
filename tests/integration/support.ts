import type { UserRole } from "@prisma/client";
import { isAppError, type AppError, type ErrorCode } from "@/lib/errors";

/**
 * Integration harness entry point.
 *
 * `src/lib/db.ts` builds its PrismaClient from `DATABASE_URL` while the module is
 * being evaluated, so pointing the suite at the test database has to happen
 * before anything imports it. That is why this module assigns the variable in its
 * own body and only then pulls in `@/lib/db` through `await import()` — a static
 * import of `@/lib/db` here would be hoisted above the assignment.
 *
 * Every test file therefore lists this module as its first import. The database
 * name is re-checked in `expectDatabaseUnderTest()` before any fixture is written,
 * so a mistake fails loudly instead of landing in `dhaka_kabab`.
 *
 * No environment value is ever printed: names only, in messages and assertions.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Integration tests refuse to start without it rather than fall back to the development database.",
  );
}

const developmentDatabaseName = dbNameOf(process.env.DATABASE_URL ?? "");
process.env.DATABASE_URL = testDatabaseUrl;

const testDatabaseName = dbNameOf(testDatabaseUrl);

const { prisma } = await import("@/lib/db");

export { prisma };
export type { Db } from "@/lib/db";

/** Reads the database out of a connection string; the rest of the URL stays private. */
function dbNameOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

/**
 * Unique per run, so a crashed earlier run cannot make this one read a stale row.
 * Short on purpose: table labels are capped at 12 characters and must embed it.
 */
export const runId = `it${Math.random().toString(36).slice(2, 6)}${process.pid % 1000}`;

/** Upper-case form, used inside table labels, which the validator forces to [A-Z0-9-]. */
export const runTag = runId.toUpperCase();

export function uniqueEmail(role: string): string {
  return `${role}-${runId}@integration.test`;
}

export function uniqueSlug(kind: string): string {
  // Slugs are validated as lowercase by the menu schema, and the run marker has to
  // survive inside them so teardown can find what it owns.
  return `${kind.toLowerCase()}-${runId}`;
}

let keyCounter = 0;

/**
 * A distinct value per call, for columns that are unique *per submission* — an
 * order's `idempotencyKey`, say, where reusing one run marker would make every
 * later order look like a replay of the first.
 */
export function uniqueKey(kind: string): string {
  keyCounter += 1;
  return `${kind}-${runId}-${keyCounter}`;
}

export function uniquePhone(): string {
  // A syntactically valid Bangladeshi mobile number in the 019x range.
  return `019${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`;
}

/**
 * Proves the connected database really is the test one, and that it is not the
 * development database. Called from every file's `beforeAll`.
 */
export async function expectDatabaseUnderTest(): Promise<string> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const connected = rows[0]?.db ?? "";
  if (!connected) throw new Error("Could not read the connected database name.");
  if (connected !== testDatabaseName) {
    throw new Error(`Refusing to run: connected to "${connected}" instead of the test database "${testDatabaseName}".`);
  }
  if (connected === developmentDatabaseName) {
    throw new Error(`Refusing to run: TEST_DATABASE_URL and DATABASE_URL name the same database ("${connected}").`);
  }
  return connected;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The configuration the assertions below are written against. `RestaurantSettings`
 * is a singleton row (`id = "default"`), so per-run copies are impossible; instead
 * every file writes this identical patch in `beforeAll`. Because all writers agree,
 * concurrent files converge on the same values instead of fighting over them.
 *
 * Written with a direct update rather than `updateSettings()`: that service call
 * appends an audit row per file per run for a configuration write that is test
 * plumbing, not something a human did.
 */
export const CANONICAL_SETTINGS = {
  name: "Dhaka Kabab Integration",
  timezone: "Asia/Dhaka",
  currencyCode: "BDT",
  currencySymbol: "৳",
  /** Open every day 11:00–23:00, so slot maths is predictable. */
  openingHours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "11:00", closes: "23:00" }],
  /** 10% service, 5% VAT, no cash rounding: every poisa in these tests is exact. */
  serviceChargeBps: 1000,
  vatBps: 500,
  vatOnServiceCharge: false,
  roundingStepPoisa: 1,
  reservationSlotMinutes: 30,
  reservationDurationMinutes: 90,
  reservationBufferMinutes: 15,
  reservationMaxDaysAhead: 60,
  reservationCutoffMinutes: 60,
  reservationDepositPoisa: 0,
  requirePolicyAcceptance: true,
  allowDineIn: true,
  allowTakeaway: true,
  allowDelivery: false,
  deliveryFeePoisa: 0,
  /** Manual confirm, so orders start in PENDING and the lifecycle is observable. */
  autoConfirmOrders: false,
  enablePartialPayments: true,
  paymentProvider: "simulated",
  emailNotificationsEnabled: false,
} as const;

/** Wall-clock times inside/around those hours. */
export const OPEN_SLOT = "18:00";
/** 18:00 seats for 90 minutes plus a 15 minute buffer, so 20:30 is free at the same table. */
export const LATER_SLOT = "20:30";
export const CLOSED_SLOT = "09:30";

export async function applyCanonicalSettings(): Promise<void> {
  await prisma.restaurantSettings.upsert({
    where: { id: "default" },
    create: { id: "default", ...CANONICAL_SETTINGS },
    update: CANONICAL_SETTINGS,
  });
  const { invalidateSettingsCache } = await import("@/server/services/settings.service");
  invalidateSettingsCache();
}

/** Local date key `days` from now, in the restaurant's own timezone. */
export async function dateKeyAhead(days: number): Promise<string> {
  const { zonedParts } = await import("@/lib/time");
  const settings = await prisma.restaurantSettings.findUnique({ where: { id: "default" }, select: { timezone: true } });
  return zonedParts(new Date(Date.now() + days * 86_400_000), settings?.timezone ?? "Asia/Dhaka").dateKey;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
//
// Service modules are imported *dynamically* here, never at the top of this file:
// a static `import "@/server/services/…"` would be hoisted above the
// `DATABASE_URL` swap above and build the Prisma client against the development
// database.

/**
 * Staff and customer accounts. The password is strong enough for the real
 * strength gate (`passwordProblem`) but is only ever used in-process.
 */
export function fixturePassword(kind: string): string {
  return `It-${kind}-${runId}-7421`;
}

export type FixtureUser = { id: string; email: string; name: string; role: UserRole; password: string };

export async function createFixtureUser(role: UserRole, label: string): Promise<FixtureUser> {
  const { hashPassword } = await import("@/lib/auth/password");
  const email = `${label}-${role.toLowerCase()}-${runId}@integration.test`;
  const password = fixturePassword(label);
  const user = await prisma.user.create({
    data: { email, name: `${label} ${role}`, role, passwordHash: await hashPassword(password), isActive: true },
  });
  track("users", user.id);
  return { id: user.id, email: user.email, name: user.name, role: user.role, password };
}

/** A live session token for an account, i.e. exactly what the cookie would carry. */
export async function sessionTokenFor(user: FixtureUser): Promise<string> {
  const { startSession } = await import("@/lib/auth/session");
  const { cookie } = await startSession({ id: user.id, email: user.email, name: user.name, role: user.role });
  return cookie;
}

/** The Bearer-header path through `getCurrentUserFromRequest`, i.e. no cookie store needed. */
export function bearerRequest(token: string, path = "/api/integration"): Request {
  return new Request(`http://localhost:3000${path}`, { headers: { authorization: `Bearer ${token}` } });
}

/**
 * A floor table with a capacity the caller controls.
 *
 * Table numbers are globally unique, and other test files run in parallel workers
 * against the same database, so a number is picked from a per-process band and
 * retried if another worker claimed it first.
 */
export async function createFixtureTable(capacity: number, options: { section?: string; enabled?: boolean } = {}) {
  const { createTable } = await import("@/server/services/table.service");
  const band = 1000 + (process.pid % 8) * 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const number = band + Math.floor(Math.random() * 990);
    const label = `T${number}`.slice(0, 12);
    try {
      const table = await createTable(
        { label, number, capacity, section: options.section ?? `IT ${runTag}`, isEnabled: options.enabled ?? true },
        null,
      );
      track("tables", table.id);
      return table;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not create a fixture table after 6 number attempts: ${String(lastError)}`);
}

export async function createFixtureCategory(label: string) {
  const { createCategory } = await import("@/server/services/menu.service");
  const category = await createCategory(
    { name: `${label} (${runId})`, slug: uniqueSlug(`${label}-cat`), description: null, imageUrl: null, sortOrder: 0, isActive: true },
    null,
  );
  track("categories", category.id);
  return category;
}

export type FixtureItem = Awaited<ReturnType<typeof createFixtureItem>>;

export async function createFixtureItem(
  categoryId: string,
  label: string,
  pricePoisa: number,
  options: { available?: boolean; prepMinutes?: number } = {},
) {
  const { createMenuItem } = await import("@/server/services/menu.service");
  const item = await createMenuItem({
    name: `${label} (${runId})`,
    slug: uniqueSlug(`${label}-item`),
    description: null,
    categoryId,
    pricePoisa,
    imageUrl: null,
    available: options.available ?? true,
    featured: false,
    prepMinutes: options.prepMinutes ?? null,
    ingredients: null,
    allergens: null,
    spicyLevel: 0,
    servesInfo: null,
    sortOrder: 0,
  }, null);
  track("menuItems", item.id);
  return item;
}

/**
 * A paid add-on group on a menu item, so an option price delta can be proven to
 * come from the database rather than from the client.
 */
export async function createFixtureOption(
  menuItemId: string,
  label: string,
  priceDeltaPoisa: number,
  options: { required?: boolean; maxSelect?: number; available?: boolean } = {},
) {
  const group = await prisma.menuItemCustomizationGroup.create({
    data: {
      menuItemId,
      name: `${label} choice`,
      required: options.required ?? false,
      minSelect: 0,
      maxSelect: options.maxSelect ?? 1,
      sortOrder: 0,
    },
  });
  const option = await prisma.menuItemCustomizationOption.create({
    data: { groupId: group.id, name: `${label} extra`, priceDeltaPoisa, available: options.available ?? true, sortOrder: 0 },
  });
  return { group, option };
}

/** Seats a party at a table, i.e. the visit every order and bill hangs off. */
export async function openFixtureSession(tableId: string, guestCount = 2, reservationId?: string) {
  const { openSession } = await import("@/server/services/table.service");
  const actor = await fixtureStaffActor();
  const session = await openSession({ tableId, guestCount, reservationId }, { userId: actor.userId });
  track("sessions", session.id);
  return session;
}

/**
 * A staff identity for service calls that only need an actor id. Fixture-owned,
 * so its audit rows and session are cleaned up with everything else.
 */
let sharedActor: { userId: string; role: string } | null = null;

export async function fixtureStaffActor(): Promise<{ userId: string; role: string }> {
  if (sharedActor) return sharedActor;
  const manager = await createFixtureUser("MANAGER", "Floor");
  sharedActor = { userId: manager.id, role: manager.role };
  return sharedActor;
}

/** Dine-in ordering context for a table: joins the session exactly as a QR scan does. */
export async function joinFixtureTable(tableToken: string, label = "Guest") {
  const { joinSessionByTableToken } = await import("@/server/services/table.service");
  const joined = await joinSessionByTableToken(tableToken, { label });
  track("sessions", joined.sessionId);
  return joined;
}

/**
 * Drops a booking's claims on tables this run does not own.
 *
 * `ReservationTableAssignment.table` is a `Restrict` foreign key, so a fixture
 * booking left sitting on a table another parallel worker created would make that
 * worker's teardown fail with P2003. Auto-assignment cannot be steered, so tests
 * release the rows they no longer need instead of hoping the picker chose a table
 * of ours.
 */
export async function releaseBookingTables(reservationId: string): Promise<void> {
  await prisma.reservationTableAssignment.deleteMany({
    where: { reservationId, tableId: { notIn: listOf(ids.tables) } },
  });
}

// ---------------------------------------------------------------------------
// Fixture registry + FK-safe teardown
// ---------------------------------------------------------------------------

const ids = {
  users: new Set<string>(),
  tables: new Set<string>(),
  categories: new Set<string>(),
  menuItems: new Set<string>(),
  reservations: new Set<string>(),
  sessions: new Set<string>(),
  orders: new Set<string>(),
  bills: new Set<string>(),
  payments: new Set<string>(),
};

export function track(kind: keyof typeof ids, id: string): void {
  ids[kind].add(id);
}

const listOf = (set: Set<string>) => [...set];

/**
 * Deletes everything this run created, in foreign-key order. Derived lookups
 * (payments on my bills, sessions on my tables) catch rows that services created
 * internally and that were never handed back to the test.
 *
 * `document_counters` rows are deliberately left alone: they are sequences, not
 * fixtures, and deleting one underneath a concurrently running file would let it
 * mint a document number that already exists.
 */
export async function cleanupFixtures(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { id: { in: listOf(ids.orders) } },
        { sessionId: { in: listOf(ids.sessions) } },
        { customerId: { in: listOf(ids.users) } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  const sessions = await prisma.tableSession.findMany({
    where: { OR: [{ id: { in: listOf(ids.sessions) } }, { tableId: { in: listOf(ids.tables) } }] },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  const bills = await prisma.bill.findMany({
    where: {
      OR: [
        { id: { in: listOf(ids.bills) } },
        { sessionId: { in: sessionIds } },
        { orderId: { in: orderIds } },
      ],
    },
    select: { id: true },
  });
  const billIds = bills.map((bill) => bill.id);

  const payments = await prisma.payment.findMany({
    where: { OR: [{ id: { in: listOf(ids.payments) } }, { billId: { in: billIds } }, { orderId: { in: orderIds } }] },
    select: { id: true },
  });
  const paymentIds = payments.map((payment) => payment.id);

  const reservations = await prisma.reservation.findMany({
    where: {
      OR: [
        { id: { in: listOf(ids.reservations) } },
        { customerId: { in: listOf(ids.users) } },
        { tables: { some: { tableId: { in: listOf(ids.tables) } } } },
      ],
    },
    select: { id: true },
  });
  const reservationIds = reservations.map((reservation) => reservation.id);

  const items = [...orderIds, ...sessionIds, ...billIds, ...paymentIds, ...reservationIds, ...listOf(ids.tables), ...listOf(ids.menuItems)];

  await prisma.refund.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { billId: { in: billIds } }] } });
  await prisma.paymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } });
  await prisma.billOrder.deleteMany({ where: { OR: [{ billId: { in: billIds } }, { orderId: { in: orderIds } }] } });
  await prisma.bill.deleteMany({ where: { id: { in: billIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.reservationTableAssignment.deleteMany({ where: { reservationId: { in: reservationIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
  await prisma.restaurantTable.deleteMany({ where: { id: { in: listOf(ids.tables) } } });
  await prisma.menuItemCustomizationGroup.deleteMany({ where: { menuItemId: { in: listOf(ids.menuItems) } } });
  await prisma.menuItem.deleteMany({ where: { OR: [{ id: { in: listOf(ids.menuItems) } }, { categoryId: { in: listOf(ids.categories) } }] } });
  await prisma.menuCategory.deleteMany({ where: { id: { in: listOf(ids.categories) } } });
  await prisma.notification.deleteMany({
    where: { OR: [{ relatedId: { in: items } }, { toAddress: { contains: runId } }] },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: listOf(ids.users) } }, { entityId: { in: items } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: listOf(ids.users) } } });

  for (const set of Object.values(ids)) set.clear();
}

/**
 * Anything left behind after teardown, reported as human-readable counts.
 *
 * Every probe keys off this run's own markers (`runId` / `runTag`) rather than off
 * the id registry, which `cleanupFixtures()` clears — a residue check that read the
 * live registry would report "clean" precisely because teardown forgot something.
 */
export async function findResidue(): Promise<string[]> {
  const found: string[] = [];
  const checks: [string, Promise<number>][] = [
    ["users", prisma.user.count({ where: { email: { contains: runId } } })],
    ["auth sessions", prisma.session.count({ where: { user: { email: { contains: runId } } } })],
    ["tables", prisma.restaurantTable.count({ where: { label: { contains: runTag } } })],
    ["menu categories", prisma.menuCategory.count({ where: { slug: { contains: runId } } })],
    ["menu items", prisma.menuItem.count({ where: { slug: { contains: runId } } })],
    ["orders", prisma.order.count({ where: { customer: { email: { contains: runId } } } })],
    ["reservations", prisma.reservation.count({ where: { OR: [{ email: { contains: runId } }, { customerName: { contains: runTag } }] } })],
    ["bills", prisma.bill.count({ where: { session: { table: { label: { contains: runTag } } } } })],
    ["payments", prisma.payment.count({ where: { bill: { session: { table: { label: { contains: runTag } } } } } })],
    ["notifications", prisma.notification.count({ where: { toAddress: { contains: runId } } })],
    ["audit logs", prisma.auditLog.count({ where: { OR: [{ actor: { email: { contains: runId } } }, { actorLabel: { contains: runTag } }] } })],
  ];
  for (const [label, query] of checks) {
    const count = await query;
    if (count > 0) found.push(`${label}: ${count}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Assertion helper for "this must be refused"
// ---------------------------------------------------------------------------

/**
 * Runs a service call that is expected to be refused and returns the AppError it
 * threw. A call that succeeds is itself a failure, so this can never swallow a
 * problem the way a bare try/catch would.
 */
export async function expectRefusal(
  action: () => Promise<unknown>,
  code: ErrorCode,
  label: string,
): Promise<AppError> {
  let result: unknown;
  try {
    result = await action();
  } catch (error) {
    if (!isAppError(error)) {
      throw new Error(`${label}: expected an AppError with code ${code}, got ${describe(error)}`);
    }
    if (error.code !== code) {
      throw new Error(`${label}: expected code ${code}, got ${error.code} (${error.status}) — "${error.message}"`);
    }
    return error;
  }
  throw new Error(`${label}: expected a ${code} refusal, but the call returned ${typeof result}`);
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error;
}

// ---------------------------------------------------------------------------
// Additional shared helpers appended for the extended integration suite.
// Existing exports above are untouched; these are purely additive.
// ---------------------------------------------------------------------------

/**
 * A dine-in guest who has joined a fixture table's session — the actor every
 * order, bill and gateway payment in the added files hangs off. Services are
 * pulled in dynamically for the same reason as every other builder here: a
 * static import would be hoisted above the `DATABASE_URL` swap at the top of
 * this module and build the client against the development database.
 */
export type FixtureVisit = {
  table: Awaited<ReturnType<typeof createFixtureTable>>;
  sessionId: string;
  participantToken: string;
};

export async function createFixtureVisit(label: string): Promise<FixtureVisit> {
  const table = await createFixtureTable(4);
  const joined = await joinFixtureTable(table.publicToken, `${label} ${runTag}`);
  return { table, sessionId: joined.sessionId, participantToken: joined.participantToken };
}

/**
 * A DINE_IN order placed at a visit through the real `createOrder` service.
 * Prices, totals and charges are re-derived by the server from the menu row; the
 * payload only ever carries ids and a quantity. `keyPrefix` namespaces the
 * idempotency key so repeated helper calls never collide on the unique column.
 */
export async function createFixtureDineInOrder(
  visit: FixtureVisit,
  menuItemId: string,
  quantity: number,
  options: { keyPrefix?: string; instructions?: string | null } = {},
) {
  const { createOrder } = await import("@/server/services/order.service");
  const input = {
    type: "DINE_IN" as const,
    tableToken: visit.table.publicToken,
    participantToken: visit.participantToken,
    items: [{ menuItemId, quantity, options: [], instructions: options.instructions ?? null }],
    idempotencyKey: uniqueKey(options.keyPrefix ?? "order"),
  };
  const result = await createOrder(input, { customerId: null });
  track("orders", result.order.id);
  return result;
}
