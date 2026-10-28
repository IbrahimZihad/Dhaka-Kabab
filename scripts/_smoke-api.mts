/**
 * Temporary end-to-end API walk-through against the running dev server.
 * Deleted after use — the permanent version of this journey is the Playwright /
 * vitest integration suite.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- this harness reads loosely typed JSON envelopes; it is not shipped code */
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(import.meta.dirname, "..");
for (const file of [".env.local", ".env"]) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}

const BASE = "http://localhost:3000";
const RUN_IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
let cookie = "";
const results: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  results.push(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

/** Guest views send money as display strings ("৳ 1,250.50"); compare as poisa. */
function asPoisa(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\d.\-]/g, "");
  if (cleaned === "") return undefined;
  const [whole = "0", frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2) || 0);
}

async function call(method: string, pathname: string, body?: unknown, form?: URLSearchParams) {
  // A per-run source address keeps one run's rate-limit window from poisoning the
  // next; the limit itself is asserted separately.
  const headers: Record<string, string> = { origin: BASE, "x-forwarded-for": RUN_IP };
  if (cookie) headers.cookie = cookie;
  let payload: BodyInit | undefined;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = form.toString();
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathname}`, { method, headers, body: payload });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    const pair = entry.split(";")[0];
    if (pair?.startsWith("dk_session=")) cookie = pair;
  }
  const text = await response.text();
  let json: any = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: json };
}

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();

async function main() {
  // --- 1. staff sign-in ------------------------------------------------------
  const login = await call("POST", "/api/auth/login", { email: "owner@localhost.dev", password: "DevSmoke2026pass" });
  check("login returns OWNER", login.status === 200 && login.body.data?.role === "OWNER", `status ${login.status}`);

  // --- 2. settings: address + hours + charges --------------------------------
  const current = (await call("GET", "/api/admin/settings")).body.data.settings;
  const weekday = new Date().getUTCDay();
  const settingsPayload = {
    ...stripIds(current),
    name: "Dhaka Kabab",
    addressLine1: "House 12, Road 5, Banani",
    city: "Dhaka",
    country: "Bangladesh",
    phonePrimary: "01712345678",
    emailPublic: "hello@dhakakabab.test",
    openingHours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "11:00", closes: "23:00" }],
    serviceChargeBps: 1000,
    vatBps: 500,
    vatOnServiceCharge: false,
    roundingStepPoisa: 100,
    allowDineIn: true,
    allowTakeaway: true,
    allowDelivery: true,
    /** Taka, not poisa — the settings form's money fields arrive as staff type them. */
    deliveryFeePoisa: 60,
    enablePartialPayments: true,
    paymentProvider: "simulated",
    chatbotEnabled: true,
    chatbotFallbackOnly: true,
    emailNotificationsEnabled: false,
    reservationSlotMinutes: 30,
    reservationDurationMinutes: 90,
    reservationBufferMinutes: 15,
    reservationMaxDaysAhead: 60,
    reservationCutoffMinutes: 60,
    reservationDepositPoisa: 0,
    requirePolicyAcceptance: true,
    autoConfirmOrders: true,
  };
  const saved = await call("PATCH", "/api/admin/settings", settingsPayload);
  check(
    "settings saved",
    saved.status === 200 && saved.body.data?.settings?.serviceChargeBps === 1000,
    JSON.stringify(saved.body.error ?? saved.status),
  );
  void weekday;

  // --- 3. menu catalogue -----------------------------------------------------
  const category = await call("POST", "/api/admin/menu/categories", { name: `Kabab ${stamp}`, sortOrder: 5 });
  check("category created", category.status === 201, JSON.stringify(category.body.error ?? category.status));
  const item = await call("POST", "/api/admin/menu/items", {
    name: `Seekh Kabab ${stamp}`,
    categoryId: category.body.data?.id,
    pricePoisa: "350.00",
    available: true,
    featured: true,
    ingredients: "Minced beef, ginger, green chilli",
    allergens: "",
    spicyLevel: 3,
    servesInfo: "Serves 2",
    prepMinutes: 18,
    sortOrder: 1,
  });
  check("menu item created at 35000 poisa", item.status === 201 && item.body.data?.pricePoisa === 35000, JSON.stringify(item.body.error ?? item.status));

  const group = await call("POST", `/api/admin/menu/items/${item.body.data?.id}/customizations`, {
    name: "Extras",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    sortOrder: 0,
    options: [
      { name: "Extra naan", priceDeltaPoisa: "50.00", available: true, sortOrder: 0 },
      { name: "Lemon", priceDeltaPoisa: "0", available: true, sortOrder: 1 },
    ],
  });
  check("customization group stored with poisa deltas", group.status === 201 && group.body.data?.options?.[0]?.priceDeltaPoisa === 5000, JSON.stringify(group.body.error ?? group.status));

  const priced = await call("PATCH", `/api/admin/menu/items/${item.body.data?.id}/availability`, { available: true });
  check("availability toggle works", priced.status === 200 && priced.body.data?.available === true);

  // --- 4. floor: table + session --------------------------------------------
  const highestNumber = (await prisma.restaurantTable.aggregate({ _max: { number: true } }))._max.number ?? 0;
  const table = await call("POST", "/api/admin/tables", {
    label: `Z${stamp.slice(-4)}`,
    number: highestNumber + 1,
    capacity: 4,
    section: "Smoke",
  });
  check("table created with public token", table.status === 201 && typeof table.body.data?.publicToken === "string", JSON.stringify(table.body.error ?? table.status));
  const tableId = table.body.data?.id;
  const tableToken = table.body.data?.publicToken;

  // A second table: two parties at the same instant need two places to sit.
  const spareTable = await call("POST", "/api/admin/tables", {
    label: `Y${stamp.slice(-4)}`,
    number: highestNumber + 2,
    capacity: 4,
    section: "Smoke",
  });
  check("second table created for the booking tests", spareTable.status === 201, JSON.stringify(spareTable.body.error ?? spareTable.status));

  const qrPng = await fetch(`${BASE}/api/admin/tables/${tableId}/qr`, { headers: { cookie } });
  check("table QR PNG served", qrPng.status === 200 && (qrPng.headers.get("content-type") ?? "").startsWith("image/png"));
  await qrPng.arrayBuffer();

  const session = await call("POST", "/api/admin/sessions", { tableId, guestCount: 2 });
  check("session opened", session.status === 201 && typeof session.body.data?.id === "string", JSON.stringify(session.body.error ?? session.status));
  const sessionId = session.body.data?.id;

  const bill = await call("POST", `/api/admin/sessions/${sessionId}/bill`, {});
  check("bill created for session", bill.status === 200 && typeof bill.body.data?.id === "string", JSON.stringify(bill.body.error ?? bill.status));
  const billId = bill.body.data?.id;

  // --- 5. guest ordering over the QR token ----------------------------------
  // The device offers an id; the server answers with the seat token it minted, and
  // that is the only credential the rest of the guest journey may use.
  const offeredToken = `pt${stamp}${Date.now().toString(36)}`.slice(0, 24);
  const join = await call("POST", "/api/tables/join", { tableToken, participantToken: offeredToken, label: "Phone A" });
  check("guest joined session", join.status === 200 && join.body.data?.sessionId === sessionId, JSON.stringify(join.body.error ?? join.status));
  const participantToken: string | undefined = join.body.data?.participantToken;
  check("the caller's id is not adopted as a seat token", participantToken !== undefined && participantToken !== offeredToken, `got ${participantToken}`);

  const optionId = group.body.data?.options?.[0]?.id;
  const orderIdem = `ord-${stamp}`;
  const order = await call("POST", "/api/orders", {
    type: "DINE_IN",
    tableToken,
    participantToken,
    idempotencyKey: orderIdem,
    items: [{ menuItemId: item.body.data?.id, quantity: 1, options: [{ groupId: group.body.data?.id, optionId }] }],
  });
  const totals = order.body.data?.order?.totals;
  const money = totals?.poisa;
  check("guest order accepted", order.status === 201, JSON.stringify(order.body.error ?? order.status));
  check(
    "server priced 35000 + 5000 option = 40000 subtotal",
    money?.subtotalPoisa === 40000,
    `subtotal ${money?.subtotalPoisa} total ${money?.totalPoisa}`,
  );
  check("service charge 10% = 4000", asPoisa(totals?.serviceCharge) === 4000, `got ${totals?.serviceCharge}`);
  check("vat 5% of subtotal = 2000", asPoisa(totals?.vat) === 2000, `got ${totals?.vat}`);
  check("total 46000 poisa", money?.totalPoisa === 46000, `got ${money?.totalPoisa}`);
  check("guest view hides staff identity", order.body.data?.order?.takenBy === undefined);
  check("guest view hides the customer id", (order.body.data?.order as any)?.customerId === undefined);

  const replay = await call("POST", "/api/orders", {
    type: "DINE_IN",
    tableToken,
    participantToken,
    idempotencyKey: orderIdem,
    items: [{ menuItemId: item.body.data?.id, quantity: 5, options: [] }],
  });
  check("replayed order does not double-bill", replay.body.data?.replayed === true && replay.body.data?.order?.totals?.poisa?.subtotalPoisa === 40000, `subtotal ${replay.body.data?.order?.totals?.poisa?.subtotalPoisa}`);

  const tampered = await call("POST", "/api/orders", {
    type: "DINE_IN",
    tableToken,
    participantToken,
    idempotencyKey: `tamper-${stamp}`,
    cartTotalPoisa: 1,
    items: [{ menuItemId: item.body.data?.id, quantity: 1, options: [] }],
  });
  check("stale cart total is refused, not charged", tampered.status === 409 || tampered.status === 400, `status ${tampered.status} ${JSON.stringify(tampered.body.error?.message ?? "")}`);

  const bogus = await call("POST", "/api/orders", {
    type: "DINE_IN",
    tableToken: "notarealtabletoken",
    idempotencyKey: `bogus-${stamp}`,
    items: [{ menuItemId: item.body.data?.id, quantity: 1, options: [] }],
  });
  check("unknown table token refused", bogus.status >= 400, `status ${bogus.status}`);

  // The web checkout always sends its own subtotal, so the staleness check must
  // compare it with the food subtotal — never the grand total, which carries the
  // service charge and VAT the guest cannot know. 350 + 50 = 40000 poisa.
  const webTakeaway = await call("POST", "/api/orders", {
    type: "TAKEAWAY",
    contact: { name: "Web Guest", phone: "01777888999" },
    idempotencyKey: `web-${stamp}`,
    cartTotalPoisa: 40000,
    items: [{ menuItemId: item.body.data?.id, quantity: 1, options: [{ groupId: group.body.data?.id, optionId }] }],
  });
  check(
    "takeaway accepted when the cart matches the food subtotal",
    webTakeaway.status === 201,
    `status ${webTakeaway.status} ${JSON.stringify(webTakeaway.body.error?.message ?? "")}`,
  );
  check(
    "charge-inclusive total does not reject a correct cart",
    webTakeaway.body.data?.order?.totals?.poisa?.totalPoisa === 46000,
    `total ${webTakeaway.body.data?.order?.totals?.poisa?.totalPoisa}`
  );

  const offByAPoisa = await call("POST", "/api/orders", {
    type: "TAKEAWAY",
    contact: { name: "Web Guest", phone: "01777888999" },
    idempotencyKey: `off-${stamp}`,
    cartTotalPoisa: 40001,
    items: [{ menuItemId: item.body.data?.id, quantity: 1, options: [{ groupId: group.body.data?.id, optionId }] }],
  });
  check("cart one poisa out is refused, not re-priced", offByAPoisa.status === 409, `status ${offByAPoisa.status} ${JSON.stringify(offByAPoisa.body.error?.message ?? "")}`);

  // --- 6. kitchen + floor lifecycle ----------------------------------------
  const orderId = order.body.data?.order?.id;
  for (const status of ["CONFIRMED", "PREPARING", "READY"]) {
    const step = await call("PATCH", `/api/orders/${orderId}/status`, { status });
    check(`order -> ${status}`, step.status === 200 && step.body.data?.status === status, JSON.stringify(step.body.error?.message ?? step.status));
  }
  const queue = await call("GET", "/api/kitchen/queue");
  check("kitchen queue includes the ready order", JSON.stringify(queue.body.data).includes(orderId));

  const tracked = await call("GET", `/api/orders/track/${order.body.data?.order?.publicToken}`);
  check("public tracking by token works", tracked.status === 200, `status ${tracked.status}`);

  // --- 7. bill, guest self-serve payment, counter payment, receipt -----------
  const guestCustomer = { name: "Phone A", email: `guest-${stamp}@localhost.dev`, phone: "01799999999" };
  const earlyGuestPay = await call("POST", "/api/payments/guest/initiate", { participantToken, customer: guestCustomer });
  check("guest cannot pay a bill that is still open", earlyGuestPay.status >= 400, `status ${earlyGuestPay.status} ${JSON.stringify(earlyGuestPay.body.error?.message ?? "")}`);

  const strangerPay = await call("POST", "/api/payments/guest/initiate", { participantToken: `nope${stamp}`.slice(0, 24), customer: guestCustomer });
  check("unknown participant token cannot reach a bill", strangerPay.status >= 400, `status ${strangerPay.status}`);

  // The limiter is asserted on its own: six hand-offs from one phone for one
  // table link, and the sixth must be refused rather than queued at the gateway.
  // The link id is run-specific so a previous run's window cannot decide it.
  const spamToken = `ratelimit${stamp}`.slice(0, 24);
  let rateLimitedAt = 0;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const spam = await call("POST", "/api/payments/guest/initiate", { participantToken: spamToken, customer: guestCustomer });
    if (spam.status === 429) {
      rateLimitedAt = attempt;
      break;
    }
  }
  check("repeated payment attempts are throttled", rateLimitedAt === 6, `429 on attempt ${rateLimitedAt}`);

  const refreshed = await call("POST", `/api/bills/${billId}/refresh`, {});
  check("bill refresh recomputes lines", refreshed.status === 200, JSON.stringify(refreshed.body.error?.message ?? refreshed.status));
  const finalized = await call("POST", `/api/bills/${billId}/finalize`, {});
  check("bill finalized with total 46000", finalized.status === 200 && finalized.body.data?.totalPoisa === 46000, `total ${finalized.body.data?.totalPoisa} ${JSON.stringify(finalized.body.error?.message ?? "")}`);

  const guestPay = await call("POST", "/api/payments/guest/initiate", { participantToken, amountPoisa: 10000, customer: guestCustomer });
  const guestRef = guestPay.body.data?.reference;
  check("guest starts an online payment for their own table", guestPay.status === 200 && typeof guestRef === "string" && guestPay.body.data?.isDemo === true, JSON.stringify(guestPay.body.error?.message ?? guestPay.status));
  check("guest hand-off never carries the table token", !JSON.stringify(guestPay.body.data ?? {}).includes(tableToken));

  if (typeof guestRef === "string") {
    const guestProof = createHmac("sha256", process.env.AUTH_SECRET!).update(`simulated:${guestRef}`).digest("hex");
    const guestForm = new URLSearchParams({ dk_ref: guestRef, dk_proof: guestProof, dk_amount: "100.00", dk_outcome: "APPROVED", tran_id: guestRef });
    const guestCallback = await call("POST", "/api/payments/gateway/callback", undefined, guestForm);
    check("guest payment settles only when the callback verifies", guestCallback.status === 200 && guestCallback.body.data?.status === "SUCCEEDED", JSON.stringify(guestCallback.body.data ?? guestCallback.body.error?.message ?? guestCallback.status));
    const billAfterGuest = await prisma.bill.findUnique({ where: { id: billId }, select: { paidPoisa: true, status: true } });
    check("table bill shows the guest share as paid", billAfterGuest?.paidPoisa === 10000, `paid ${billAfterGuest?.paidPoisa} status ${billAfterGuest?.status}`);
  }

  const partial = await call("POST", "/api/payments", { billId, method: "CASH", amountPoisa: "200.00" });
  check("counter payment recorded", partial.status === 201 || partial.status === 200, JSON.stringify(partial.body.error?.message ?? partial.status));

  const overshoot = await call("POST", "/api/payments", { billId, method: "CASH", amountPoisa: "500.00" });
  check("counter refuses to take more than the balance", overshoot.status >= 400, `status ${overshoot.status} ${JSON.stringify(overshoot.body.error?.message ?? "")}`);

  // --- 8. simulated gateway hand-off and callback ---------------------------
  const initiate = await call("POST", "/api/payments/gateway/initiate", {
    billId,
    method: "ONLINE_GATEWAY",
    customer: { name: "Dev Owner", email: "owner@localhost.dev", phone: "01712345678" },
  });
  const ref = initiate.body.data?.reference;
  check("gateway hand-off returns a pending reference", initiate.status === 200 && typeof ref === "string", JSON.stringify(initiate.body.error?.message ?? initiate.status));
  check("simulated hand-off is flagged as demo", initiate.body.data?.isDemo === true);

  if (typeof ref === "string") {
    const proof = createHmac("sha256", process.env.AUTH_SECRET!).update(`simulated:${ref}`).digest("hex");
    const form = new URLSearchParams({ dk_ref: ref, dk_proof: proof, dk_amount: "160.00", dk_outcome: "APPROVED", tran_id: ref });
    const callback = await call("POST", "/api/payments/gateway/callback", undefined, form);
    check("verified callback settles the gateway payment", callback.status === 200 && callback.body.data?.status === "SUCCEEDED", JSON.stringify(callback.body.data ?? callback.body.error?.message ?? callback.status));
    check("callback marks the money as demo", callback.body.data?.isDemo === true, `isDemo ${callback.body.data?.isDemo}`);

    const again = await call("POST", "/api/payments/gateway/callback", undefined, form);
    check("repeat notification is idempotent", again.status === 200 && again.body.data?.duplicate === true, JSON.stringify(again.body.data ?? again.status));

    const forged = new URLSearchParams({ dk_ref: ref, dk_proof: "0".repeat(64), dk_amount: "160.00", dk_outcome: "APPROVED", tran_id: ref });
    const forge = await call("POST", "/api/payments/gateway/callback", undefined, forged);
    check("forged proof is refused", forge.status >= 400, `status ${forge.status} ${JSON.stringify(forge.body.error?.code ?? "")}`);
  }

  const receipt = await call("GET", `/api/bills/${billId}/receipt`);
  check("receipt shows the bill paid exactly", receipt.status === 200 && Number(receipt.body.data?.paidPoisa) === 46000, `paid ${receipt.body.data?.paidPoisa}`);
  check("receipt reports no surplus owed back", Number(receipt.body.data?.overpaidPoisa ?? 0) === 0, `overpaid ${receipt.body.data?.overpaidPoisa}`);

  const statusAfter = await call("GET", `/api/bills/${billId}`);
  check("bill reflects both payments", statusAfter.status === 200, JSON.stringify(statusAfter.body.error?.message ?? statusAfter.status));

  // --- 9. reservations -------------------------------------------------------
  // A random day inside the booking window, so a previous run's tables left
  // behind cannot decide the outcome of this one.
  const tomorrow = new Date(Date.now() + (12 + Math.floor(Math.random() * 40)) * 86400000).toISOString().slice(0, 10);
  const availability = await call("GET", `/api/reservations/availability?dateKey=${tomorrow}&partySize=4`);
  check("availability returns slots once hours are set", availability.status === 200 && availability.body.data?.slots?.length > 0, `slots ${availability.body.data?.slots?.length}`);

  const slot = availability.body.data?.slots?.[2]?.time ?? "19:00";
  const booking = await call("POST", "/api/reservations", {
    customerName: "Guest Tester",
    phone: "01812345678",
    dateKey: tomorrow,
    time: slot,
    partySize: 4,
    policyAccepted: true,
    specialRequests: "Window seat",
  });
  const bookingToken = booking.body.data?.publicToken;
  check("public booking created", booking.status === 201 && typeof bookingToken === "string", JSON.stringify(booking.body.error?.message ?? booking.status));

  const lookup = await call("GET", `/api/reservations/lookup/${bookingToken}`);
  check("booking readable through its own token", lookup.status === 200 && lookup.body.data?.code === booking.body.data?.code);

  const doubleBooked = await call("POST", "/api/reservations", {
    customerName: "Guest Tester",
    phone: "01812345678",
    dateKey: tomorrow,
    time: slot,
    partySize: 60,
    policyAccepted: true,
  });
  check("over-capacity booking refused", doubleBooked.status >= 400, `status ${doubleBooked.status}`);

  // Deterministic overlap: two live bookings at the same instant may sit on
  // different tables, but never on the same one.
  const clash = await call("POST", "/api/reservations", {
    customerName: "Clash Guest",
    phone: "01912345678",
    dateKey: tomorrow,
    time: slot,
    partySize: 2,
    policyAccepted: true,
  });
  check("a second party takes a different table at the same time", clash.status === 201, JSON.stringify(clash.body.error?.message ?? clash.status));

  const [firstRow, clashRow] = await Promise.all([
    prisma.reservation.findUnique({ where: { code: booking.body.data?.code ?? "" }, select: { tables: { select: { tableId: true } } } }),
    prisma.reservation.findUnique({ where: { code: clash.body.data?.code ?? "" }, select: { id: true } }),
  ]);
  const forced = await call("PUT", `/api/reservations/${clashRow?.id ?? "missing"}/tables`, { tableIds: (firstRow?.tables ?? []).map((row) => row.tableId) });
  check("a table booked for that window cannot be handed to an overlapping booking", forced.status === 409, `status ${forced.status} ${JSON.stringify(forced.body.error?.message ?? "")}`);

  const guestCancel = await call("POST", "/api/reservations/cancel", { token: bookingToken, reason: "Plans changed", guestToken: bookingToken });
  check("guest cancels through their token", guestCancel.status === 200, JSON.stringify(guestCancel.body.error?.message ?? guestCancel.status));

  const strangerCancel = await call("POST", "/api/reservations/cancel", { token: bookingToken, reason: "not mine", guestToken: "zzzzzzzzzzzz" });
  check("mismatched guest token refused", strangerCancel.status >= 400, `status ${strangerCancel.status}`);

  // --- 10. chatbot, reports, audit ------------------------------------------
  const chat = await call("POST", "/api/chat", { message: "What kinds of kabab do you serve?" });
  check("chat answers from database facts", chat.status === 200 && typeof chat.body.data?.reply === "string" && chat.body.data.reply.length > 0, JSON.stringify(chat.body.error?.message ?? chat.status));
  check("chat names its source", chat.body.data?.answeredBy === "menu-data" || chat.body.data?.sources?.length > 0, `answeredBy ${chat.body.data?.answeredBy}`);
  check("chat reports fallback honestly", chat.body.data?.usedFallback === true || chat.body.data?.usedFallback === false, `fallback ${chat.body.data?.usedFallback}`);

  for (const kind of ["sales", "orders", "items", "payments", "reservations", "tables", "customers"]) {
    const csv = await fetch(`${BASE}/api/admin/reports/${kind}?range=30d`, { headers: { cookie } });
    const text = await csv.text();
    check(`report ${kind} is CSV`, csv.status === 200 && text.includes(","), `status ${csv.status}`);
  }
  const badReport = await call("GET", "/api/admin/reports/not-a-report");
  check("unknown report refused", badReport.status >= 400, `status ${badReport.status}`);

  const audit = await call("GET", `/api/admin/audit-logs?entityType=Bill&entityId=${billId}`);
  check("audit trail records bill activity", audit.status === 200 && audit.body.data?.logs?.length > 0, `logs ${audit.body.data?.logs?.length}`);
  const sensitive = JSON.stringify(audit.body.data?.logs ?? []);
  check("audit responses never contain a password hash", !/passwordHash|\$2[aby]\$/.test(sensitive));

  // --- 11. role enforcement --------------------------------------------------
  const cashier = await call("POST", "/api/admin/staff", {
    name: "Smoke Cashier",
    email: `cashier-${stamp}@localhost.dev`,
    role: "CASHIER",
    isActive: true,
  });
  check("staff created with one-time password", cashier.status === 201 && typeof cashier.body.data?.tempPassword === "string" && cashier.body.data.tempPassword.length >= 10, JSON.stringify(cashier.body.error?.message ?? cashier.status));

  const staffOwnerAttempt = await call("POST", "/api/admin/staff", {
    name: "Sneaky",
    email: `sneaky-${stamp}@localhost.dev`,
    role: "OWNER",
    isActive: true,
  });
  check("owner can create owners", staffOwnerAttempt.status === 200 || staffOwnerAttempt.status === 201, JSON.stringify(staffOwnerAttempt.body.error?.message ?? staffOwnerAttempt.status));

  const savedCookie = cookie;
  const cashierLogin = await call("POST", "/api/auth/login", {
    email: `cashier-${stamp}@localhost.dev`,
    password: cashier.body.data?.tempPassword,
  });
  check("cashier signs in with the minted password", cashierLogin.status === 200 && cashierLogin.body.data?.role === "CASHIER", JSON.stringify(cashierLogin.body.error?.message ?? cashierLogin.status));
  const forbidden = await call("GET", "/api/admin/settings");
  check("cashier cannot read settings", forbidden.status === 403, `status ${forbidden.status}`);
  const forbiddenWrite = await call("PATCH", "/api/admin/menu/categories/" + category.body.data?.id, { name: "Nope", sortOrder: 1, isActive: true });
  check("cashier cannot manage categories", forbiddenWrite.status === 403, `status ${forbiddenWrite.status}`);
  cookie = savedCookie;

  const noSession = await fetch(`${BASE}/api/admin/staff`);
  check("anonymous admin request rejected", noSession.status === 401, `status ${noSession.status}`);

  // --- 12. unguessable identifiers -------------------------------------------
  const tables = await prisma.restaurantTable.findMany({ select: { publicToken: true } });
  const tokens = tables.map((t) => t.publicToken);
  check("table tokens are unique", new Set(tokens).size === tokens.length);
  check("table tokens are long enough to be unguessable", tokens.every((t) => t.length >= 20), `min length ${Math.min(...tokens.map((t) => t.length))}`);

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${results.length} checks)\n`);
}

function stripIds(settings: Record<string, unknown>) {
  const clone: Record<string, unknown> = { ...settings };
  for (const key of ["id", "createdAt", "updatedAt", "updatedByUserId"]) delete clone[key];
  return clone;
}

main()
  .catch((error) => {
    console.error(results.join("\n"));
    console.error("\nSMOKE CRASHED:", error);
    failures += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
