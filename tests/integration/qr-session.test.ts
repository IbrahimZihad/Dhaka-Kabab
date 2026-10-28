import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCanonicalSettings,
  cleanupFixtures,
  createFixtureCategory,
  createFixtureDineInOrder,
  createFixtureItem,
  createFixtureTable,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  joinFixtureTable,
  prisma,
  runTag,
  type FixtureVisit,
} from "./support";
import { joinSessionByTableToken, resolveTableToken, setTableStatus } from "@/server/services/table.service";
import { getSessionOrdersForGuest } from "@/server/services/order.service";
import { randomToken } from "@/lib/ids";

/**
 * QR table sessions. The promise is that a table's public link is unpredictable
 * (nobody can guess or walk it), that an unrecognised or inactive table is refused
 * at the single entry point, and that everyone who scans the same placard lands in
 * one shared visit while each order stays attributed to the phone that placed it.
 */

const KEBAB_PRICE = 250_00;

let kebab: Awaited<ReturnType<typeof createFixtureItem>>;

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  const category = await createFixtureCategory("Grill");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("table tokens are unpredictable", () => {
  it("mints distinct, high-entropy tokens that leak neither the table label nor its number", async () => {
    const first = await createFixtureTable(2);
    const second = await createFixtureTable(2);

    expect(first.publicToken).not.toBe(second.publicToken);
    // 16 random bytes base64url is ~22 characters — not a short sequential id.
    expect(first.publicToken.length).toBeGreaterThanOrEqual(22);
    expect(second.publicToken.length).toBeGreaterThanOrEqual(22);

    for (const table of [first, second]) {
      // Nothing a caller could guess: the human-facing label and the run marker are
      // absent, and the token is plainly not the table number.
      expect(table.publicToken).not.toContain(table.label);
      expect(table.publicToken).not.toContain(runTag);
      expect(table.publicToken).not.toBe(String(table.number));
    }

    // Two guests on one table get distinct participant links too.
    const a = await joinFixtureTable(first.publicToken, "Alice");
    const b = await joinFixtureTable(first.publicToken, "Bob");
    expect(a.participantToken).not.toBe(b.participantToken);
    expect(a.participantToken.length).toBeGreaterThanOrEqual(16);
  });

  it("refuses a table token that was never issued", async () => {
    const unknown = randomToken(16);
    await expectRefusal(() => resolveTableToken(unknown), "NOT_FOUND", "unknown table token");
  });
});

describe("only an open table accepts a visit", () => {
  it("refuses a disabled table at both the resolve and the guest join", async () => {
    const table = await createFixtureTable(2, { enabled: false });

    await expectRefusal(() => resolveTableToken(table.publicToken), "TABLE_INACTIVE", "resolve a disabled table");
    const error = await expectRefusal(
      () => joinSessionByTableToken(table.publicToken, { label: "Would-be guest" }),
      "TABLE_INACTIVE",
      "join a disabled table",
    );
    expect(error.message).toMatch(/closed for ordering/i);
    // The refusal opened nothing.
    expect(await prisma.tableSession.count({ where: { tableId: table.id } })).toBe(0);
  });

  it("refuses a table that is being cleaned", async () => {
    const table = await createFixtureTable(2);
    await setTableStatus(table.id, "CLEANING", null);

    await expectRefusal(() => resolveTableToken(table.publicToken), "TABLE_INACTIVE", "resolve a cleaning table");
    const error = await expectRefusal(() => joinFixtureTable(table.publicToken, "Too early"), "TABLE_INACTIVE", "join a cleaning table");
    expect(error.message).toMatch(/being cleaned/i);
  });
});

describe("one placard, one visit, every phone keeps its own orders", () => {
  it("seats two participants in the same session and attributes each order to its own guest", async () => {
    const table = await createFixtureTable(4);
    const alice = await joinFixtureTable(table.publicToken, "Alice");
    const bob = await joinFixtureTable(table.publicToken, "Bob");

    // Both scans landed in a single shared visit.
    expect(alice.sessionId).toBe(bob.sessionId);
    expect(alice.wasAutoOpened).toBe(true);
    expect(bob.wasAutoOpened).toBe(false);

    const visitFor = (joined: typeof alice): FixtureVisit => ({
      table,
      sessionId: joined.sessionId,
      participantToken: joined.participantToken,
    });
    const { order: aliceOrder } = await createFixtureDineInOrder(visitFor(alice), kebab.id, 1, { keyPrefix: "qr-alice" });
    const { order: bobOrder } = await createFixtureDineInOrder(visitFor(bob), kebab.id, 2, { keyPrefix: "qr-bob" });

    // Each order is stamped with its own session and a distinct participant.
    expect(aliceOrder.sessionId).toBe(alice.sessionId);
    expect(bobOrder.sessionId).toBe(bob.sessionId);
    expect(aliceOrder.participantId).not.toBeNull();
    expect(bobOrder.participantId).not.toBeNull();
    expect(aliceOrder.participantId).not.toBe(bobOrder.participantId);

    // The shared guest view shows the whole table's orders to both participants.
    const fromAlice = await getSessionOrdersForGuest(alice.participantToken);
    const fromBob = await getSessionOrdersForGuest(bob.participantToken);
    const ids = (view: typeof fromAlice) => view.session.orders.map((row) => row.id);
    expect(ids(fromAlice).sort()).toEqual([aliceOrder.id, bobOrder.id].sort());
    expect(ids(fromBob).sort()).toEqual([aliceOrder.id, bobOrder.id].sort());
    // Both links resolve to the same physical table.
    expect(fromAlice.session.tableId).toBe(table.id);
    expect(fromBob.session.tableId).toBe(table.id);
    expect(fromAlice.session.id).toBe(bob.sessionId);
  });
});
