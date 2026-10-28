# Dhaka Kabab — Restaurant Management System

A full-stack, database-driven restaurant system for a Bangladeshi kabab house: public website,
QR table ordering, reservations, kitchen board, billing, payments, staff console, reports and an
assistant that answers from the real menu. It is a working application, not a mock-up — every
screen reads and writes PostgreSQL through server-side validation.

Money is Bangladeshi Taka (৳, BDT). **Every amount in code, in the database and in tests is an
integer number of poisa (1 ৳ = 100 poisa).** Floats never touch a price.

What is real and what is not, stated up front:

| Area | State |
| --- | --- |
| Menu, orders, tables, bills, payments, reservations, audit, reports | Real, database-backed, server-validated |
| Payment gateway | SSLCommerz is implemented; **without `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_API_KEY` the app uses a clearly-labelled `simulated` sandbox** and marks every such transaction in the UI, in `payments` and on receipts |
| Email | Real SMTP when `SMTP_HOST` is set; otherwise notifications are stored `QUEUED`/`SKIPPED` and the UI never claims delivery |
| AI assistant | Any OpenAI-compatible endpoint when `AI_API_KEY` + `AI_MODEL` are set; otherwise a grounded FAQ fallback that is labelled as such |
| Seed data | Demo content, flagged `isDemo` wherever the schema carries the column; the seed refuses a production database |

---

## 1. Contents of the system

| Surface | Routes | Who uses it |
| --- | --- | --- |
| Public site | `/`, `/about`, `/menu`, `/menu/[slug]`, `/contact`, `/reservations`, `/reserve/[token]`, `/reserve/confirm`, `/reserve/my`, `/track`, `/track/[token]`, `/cart`, `/checkout`, `/pay/simulated`, `/login`, `/register`, `/account`, `/reset-password` | Guests |
| Table QR flow | `/order` (joined through `/api/tables/join` with the table's public token) | Diners at a table |
| Kitchen | `/kitchen` | `KITCHEN`, `MANAGER`, `OWNER` |
| Staff console | `/admin`, `/admin/floor`, `/admin/orders[/id]`, `/admin/bills[/id]`, `/admin/menu[/id]`, `/admin/reservations[/id]`, `/admin/customers[/id]`, `/admin/staff[/id]`, `/admin/settings`, `/admin/reports`, `/admin/audit`, `/admin/chat[/token]`, `/admin/qr` | Staff roles |
| JSON API | 81 route handlers under `src/app/api/**` | The above, plus QR/gateway callbacks |

Health check: `GET /api/health` → `{"ok":true,"data":{"status":"ok","database":true,"gateway":"sandbox","time":"…"}}`.

---

## 2. Quick start (fresh machine)

```bash
npm install
cp .env.example .env.local        # then fill in AUTH_SECRET at minimum

npm run db:local:prepare          # unpacks project-owned PostgreSQL binaries
npm run db:local:start            # 127.0.0.1:55432, trust auth, data in .pgdata/ (git-ignored)
npm run db:setup                  # creates dhaka_kabab + dhaka_kabab_test, applies migrations

npm run db:generate               # Prisma client
npm run db:seed                   # demo settings, menu, floor, flagged history
npm run admin:create              # first owner, from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME

npm run env:check                 # reports missing variables by NAME, never a value
npm run dev                       # http://localhost:3000
```

Already running your own PostgreSQL 16? Skip the two `db:local` steps and point `DATABASE_URL` /
`TEST_DATABASE_URL` at it, then `npm run db:deploy`.

`npm run db:reset` drops and recreates **both** local databases. It is destructive and is meant for
a local development instance only.

---

## 3. Configuration

All configuration is environment-driven; nothing is read from the browser. `.env.example` holds
placeholders only — no populated env file is committed, and `.gitignore` excludes `.env`,
`.env.local` and `.env.*.local`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Application database. Never exposed to the client. |
| `TEST_DATABASE_URL` | for tests | Integration/e2e database. `tests/integration/support.ts` refuses to start without it and re-checks the connected database name before writing. |
| `NEXT_PUBLIC_APP_URL` | yes in production | Absolute origin for QR links, gateway callbacks, notification links. |
| `AUTH_SECRET` | yes | HS256 signing key for the `dk_session` cookie. Refuses anything under 32 characters. |
| `SESSION_MAX_AGE_SECONDS` | no (43200) | Session lifetime. |
| `NEXT_PUBLIC_REALTIME_POLL_INTERVAL_MS` | no (2500) | Floor/kitchen refresh interval; floored at 1000 ms. |
| `UPLOAD_DIR` | no (`./storage/uploads`) | Where menu image uploads are written, server side only. |
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_API_KEY` | for real money | When either is missing the simulated provider is used and labelled as such. |
| `SSLCOMMERZ_MODE` | no (`sandbox`) | `sandbox` \| `live`. |
| `SSLCOMMERZ_BASE_URL` | no | Overrides the gateway host if SSLCommerz assigns a different one. |
| `SMTP_HOST` (+ `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) | no | Without `SMTP_HOST`, notifications are recorded and never claimed as sent. |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` (+ `AI_MAX_OUTPUT_TOKENS`, `AI_REQUEST_TIMEOUT_MS`) | no | Server-side only. `OPENAI_API_KEY` / `OPENAI_MODEL` are accepted as aliases. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | for `admin:create` | Read only by that script; it refuses to run without them and never prints the password. |
| `SEED_DEMO_PASSWORD` | no | The seed creates **no accounts at all** unless this is set, and then only accounts that pass the signup strength rules. |
| `SEED_ALLOW_PRODUCTION` | no (`0`) | The seed refuses to write demo data into a production database unless this is `1`. |
| `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD` | for `test:e2e` | Local staff-login credential for the Playwright journey. Never commit a real credential. |

---

## 4. Architecture

```
src/
  app/                 Next 16 App Router: (public)/, admin/, kitchen/, api/
  components/          site/ (guest), admin/ (staff), ui/ (hand-written kit)
  lib/                 framework-free logic: money, time, billing-math, cart, rbac,
                       session, password, rate-limit, api envelope, audit, ids, env, errors
  server/
    services/          every write to the database: order, billing, payment, reservation,
                       table, menu, settings, analytics, notification, chatbot, auth, audit…
    services/providers/ llm, simulated + sslcommerz payment providers behind one interface
    validation/        zod schemas per domain (menu, order, reservation, auth, settings, common)
prisma/               schema.prisma (27 models, 16 enums), migrations/, seed.ts
tests/                unit/ (pure), integration/ (real database), e2e/ (Playwright), setup/
scripts/              postgres-local, db-setup, create-admin, check-env
```

Conventions that the codebase enforces:

- **Money** — `src/lib/money.ts` is the only place a taka string becomes poisa. Staff forms submit
  taka text, the zod transform produces an integer, and `bdtToPoisa` throws on input that contains
  no digits at all, so a typo cannot become a free item. Totals come from `src/lib/billing-math.ts`,
  which is pure and unit-tested; no handler adds up money by hand.
- **Time** — instants are UTC `timestamptz(3)` (all 64 datetime columns); everything the restaurant
  reasons about happens in the configured IANA zone through `src/lib/time.ts`. A closing time earlier
  than its opening time means the service rolls past midnight, and the hours after midnight belong to
  the day the service *started* — both the open/closed badge and the booking slot grid agree on that.
- **Trust boundary** — a client submits item ids, option ids, quantities and a session token. Prices,
  deltas, totals, charges and payment status are computed server-side from the database every time.
- **Authorisation** — every protected action names a permission (`src/lib/auth/rbac.ts`) and calls
  `requirePermission`. Hiding a button is never the control; the handler enforces it again.
- **Sessions** — `jose` HS256 cookie `dk_session` (`httpOnly`, `SameSite=Lax`, `Secure` in production)
  backed by an `auth_sessions` row. Signing out revokes the row, so the retired cookie returns
  `401 UNAUTHORIZED` immediately; disabling a staff member or revoking a session takes effect on the
  next request rather than at token expiry.
- **Errors** — one `AppError` code set (`VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `RATE_LIMITED`, …) mapped to HTTP status and a single JSON envelope
  `{ ok, data | error }` in `src/lib/api.ts`.
- **Cache Components** — `next.config.ts` runs with `cacheComponents: true`; uncached reads sit inside
  `<Suspense>`, mutations use `updateTag` in Server Actions and `revalidateTag(tag, profile)` in REST
  handlers. No `dynamic`/`revalidate` exports.
- **Client state** — small module stores + `useSyncExternalStore` (`src/lib/cart.ts`,
  `src/lib/table-seat.ts`), so no provider tree and no prop-drilled state.
- **Audit** — staff and system writes append to `audit_logs` with actor, action, entity, diff and IP.
  Financial documents are never hard-deleted: bills are voided, payments refunded, both recorded.

---

## 5. Ordering, tables and QR

- Each `RestaurantTable` carries a 16-byte random public token (`src/lib/ids.ts`). Tokens are opaque
  and unpredictable — they are not sequential and contain no table identifier — and are rotatable
  from `/admin/tables/[id]/token`. `/admin/qr` and `/admin/tables/qr-sheet` render the printable
  codes, which encode `${NEXT_PUBLIC_APP_URL}/order?table=<token>` (`table.service.ts:212`).
- A guest scans, the browser posts the token to `/api/tables/join`, and the server returns a
  `TableSession` plus a 12-byte participant token. Everything the guest can touch afterwards is
  scoped to that session; a request about somebody else's session is refused.
- Order lifecycle (server-enforced, illegal transitions refused):

  `PENDING → CONFIRMED → PREPARING → READY → SERVED → COMPLETED`, with `CANCELLED` reachable only
  from a non-terminal state. Every hop writes an `order_status_events` row. A terminal order cannot
  be re-opened, `CANCELLED` requires `order:cancel`, and kitchen-role updates may only move the three
  kitchen states.
- Guests can request the bill from the table (`/api/sessions/request-bill`); the floor shows the
  marker and the cashier settles it.
- Takeaway and delivery orders capture a name, a Bangladeshi mobile number and (for delivery) an
  address; a guest can track an order through `/track/[token]` without an account.

## 6. Billing

Charges are configurable in `/admin/settings` (basis points, so 10% is `1000`) and the maths is the
same for a table bill, a takeaway order and a receipt: subtotal → discount → charges on the
**discounted net** → VAT (optionally on the service charge too) → delivery fee → cash rounding.

Worked example with the seeded configuration (service 10%, VAT 5%, VAT applied on the service
charge, rounding to the nearest ৳1):

| Step | poisa | ৳ |
| --- | --- | --- |
| Kachchi Biryani 1 + Tandoori Chicken (half) 1 | 93 000 | 930.00 |
| Discount | −6 000 | −60.00 |
| Net | 87 000 | 870.00 |
| Service charge 10% of net | 8 700 | 87.00 |
| VAT 5% of (net + service) | 4 785 | 47.85 |
| Before rounding | 100 485 | 1 004.85 |
| Rounding adjustment | +15 | +0.15 |
| **Total** | **100 500** | **1 005.00** |

Guarantees: a discount larger than the subtotal is clamped, not negative; a negative line total is
refused outright rather than silently turning a bill into a credit; finalizing a bill whose net is ৳0
closes it as `SETTLED` and rolls its orders to `PAID` — no payment can ever be recorded against a zero
balance, so without that rule a settled table would sit on the outstanding list forever; document
numbers come from `document_counters`, so bill/order numbers are gap-free per day and never derived
from a client.

The freezing rule is by money, not by label: a bill that has taken a payment, been refunded into, or
been voided is an issued document and `refreshBillLines` will not rewrite its lines or total. A bill
that has been finalized but not yet paid *can* still be re-raised, because a table that orders a
second round after the bill was drawn up must not be able to eat unbilled. Both boundaries are
integration-tested in `tests/integration/billing.test.ts`.

## 7. Payments

`PaymentMethod`: `CASH`, `CARD`, `MOBILE_BANKING`, `ONLINE_GATEWAY`, `OTHER`.

- Counter payments are recorded by a cashier (`payment:record`) against a bill, or directly against an
  order when there is no bill to attach (a takeaway or delivery), and move `paymentStatus` through
  `UNPAID → PARTIAL → PAID` on exact boundaries. Overpayment is refused at the counter — the refund
  path exists to record the difference.
- A gateway redirect **never** marks anything paid. Initiation only creates a `Payment` row in
  `PENDING`; status changes only when the server verifies the gateway's callback/verification call —
  signature checked, transaction id matched to the stored row, amount matched, and the event recorded
  in `payment_events`. A forged or unknown callback is refused and leaves the money state untouched.
- Without gateway credentials the app offers the `simulated` provider. Its screens, its payment rows
  and its receipts say *simulated*; a simulated payment is never described as money received. The
  simulated "pay" endpoint is **switched off in production** and refuses any payment that was handed
  to a real gateway, so a demo button can never move live money.
- Refunds go through `payments/refund` (permission `payment:refund`), are recorded as `Refund` rows,
  and flip the bill to `REFUNDED` only when the refunded amount covers what was paid.

## 8. Reservations

- Availability comes from the server: `/api/reservations/availability` builds the slot grid from the
  opening-hours rules, the configured slot length, seating duration, buffer and cut-off, and only
  offers slots whose whole seating window fits inside an open range.
- Booking writes a `Reservation` plus `reservation_table_assignments`; a clash on the same table and
  overlapping window is refused with `CONFLICT`, so double-booking is impossible at the database level,
  not just in the UI.
- Status flow `PENDING → CONFIRMED → CHECKED_IN → COMPLETED`, with `CANCELLED` and `NO_SHOW`.
  Guests look a booking up through its own public token (`/reserve/[token]`, `/reserve/my`).
- Deposit amount is configurable (`reservationDepositPoisa`); ৳0 means no deposit is taken.

## 9. Roles and permissions

| Permission | OWNER | MANAGER | CASHIER | KITCHEN | CUSTOMER |
| --- | :-: | :-: | :-: | :-: | :-: |
| `kitchen:view`, `order:status:kitchen`, `order:view:any` | yes | yes | yes | yes | — |
| `order:status:floor`, `order:create:for-customer`, `table:view`, `table:session:manage` | yes | yes | yes | — | — |
| `bill:view`, `bill:manage`, `payment:record`, `payment:view`, `customer:view`, `chat:view`, `reservation:view:any` | yes | yes | yes | — | — |
| `menu:view:admin`, `menu:manage`, `category:manage`, `table:manage`, `order:cancel`, `reservation:manage`, `customer:manage`, `bill:void`, `report:view`, `audit:view` | yes | yes | — | — | — |
| `settings:manage`, `staff:manage`, `payment:refund` | yes | — | — | — | — |

`CUSTOMER` holds no staff permission; customers act through their own session-scoped endpoints only.
The kitchen screen selects no customer, phone or money column at all — financials there are gated by
`canViewKitchenFinancials` for `OWNER`/`MANAGER`/`CASHIER`.

## 10. Reports, exports and analytics

`/admin/reports` covers the seven report kinds served by `GET /api/admin/reports/[kind]` —
`sales`, `orders`, `items`, `payments`, `reservations`, `tables`, `customers` — each accepting
`?range=today|yesterday|7d|30d|month|custom&from=&to=`, all computed in the restaurant's timezone
(raw SQL buckets are anchored to the zone, never to naive UTC). Add `&format=csv` to stream the same
figures as CSV with a UTF-8 BOM so Excel reads ৳ correctly.

Cells are neutralised against CSV formula injection: a value that starts with `=`, `+`, `-`, `@` or a
tab is prefixed with `'`, and embedded quotes/commas/newlines are escaped — while genuine negative
numbers (refunds) stay numeric so they still sum in a spreadsheet.

## 11. Notifications and audit

`queueNotification()` writes a `Notification` row per event with the channel resolved from settings.
With no SMTP transport the row is `SKIPPED` with the reason; with one it is `QUEUED` and drained by
`processNotificationQueue()`. Retries are attempted at most 3 times, then `FAILED`, and
`/admin/notifications` can reset and re-run them. `/admin` (the dashboard), `/api/admin/dashboard` and `/api/admin/notifications` all report the number
of rows still `QUEUED`/`SENDING`, so a stalled queue is visible rather than silent.

Every mutation of a price, order state, bill, payment, staff account or setting appends to
`audit_logs` (`actor`, `actorType`, `action`, `entity`, `before`/`after`, IP) and `/admin/audit`
is read-only and searchable by `audit:view`.

## 12. Testing

```bash
npm run test:unit          # pure logic: money, billing maths, time/opening hours, rbac,
                           # ids, validation, csv, order lifecycle rules
npm run test:integration   # real database (needs TEST_DATABASE_URL)
npm run test:e2e           # Playwright: builds, serves `next start`, then drives real browsers
npm run test               # both vitest projects
npx tsc --noEmit && npm run lint
```

- `vitest.config.ts` defines two projects with disjoint include patterns, so a unit run can never
  reach the database and an integration run can never pass by being pure.
- Integration files must import `./support` first — that module re-points `DATABASE_URL` at
  `TEST_DATABASE_URL` before `@/lib/db` is evaluated, asserts the connected database name before
  writing a single row, and refuses if the test and development databases are the same name.
- Fixtures are run-tagged and cleaned in `afterAll`, with a `findResidue()` assertion that fails the
  run if anything was left behind.
- Playwright runs against the **production** server (`npm run build && npm run start`) by default,
  and serially, because the local development database is shared. `E2E_DEV_SERVER=1` points it at
  `npm run dev` instead, but measured on this machine `next dev` cannot carry the suite: over
  `127.0.0.1` the dev-only origin guard refuses the HMR handshake a browser sends (hence
  `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts`), and over `localhost` the dev runtime
  answers every subscribe with a `restart` of the entry chunk, which the client performs as a full
  document reload — about twelve a second, so nothing ever finishes hydrating. A pre-hydration
  click on the login form is a native submission: the fields carry `id`, not `name`, so no
  credential is ever put in a URL, but nobody is signed in either. Testing the shipped artifact
  avoids all of that instead of working around it.
- Tests assert server rules, not implementation detail. Where a test found a defect in the source,
  the source was fixed and the test now pins the correct behaviour.

## 13. Production checklist

1. `DATABASE_URL` → managed PostgreSQL (Neon/Supabase/RDS) with a non-superuser role and TLS.
2. `AUTH_SECRET` → 32+ chars from `openssl rand -base64 32`. Rotate if it was ever in a shared file.
3. `NEXT_PUBLIC_APP_URL` → the real public origin; QR codes and gateway callbacks are built from it.
4. `SSLCOMMERZ_*` → live credentials, `SSLCOMMERZ_MODE=live`, and register the callback URL
   `/api/payments/gateway/callback` at the gateway.
5. `SMTP_HOST` … `MAIL_FROM` → real transport, then confirm a queue drain in `/admin/notifications`.
6. `npm run env:check` → exits non-zero when the server cannot start; prints names, never values.
7. `npm run db:deploy` (never `migrate dev`), then `npm run admin:create` for the first owner.
   Do **not** run `npm run db:seed` against real data — it is demo content and refuses production
   unless `SEED_ALLOW_PRODUCTION=1`.
8. `npm run build && npm run start` behind a TLS-terminating proxy; set `NODE_ENV=production`.
9. Replace the seeded business identity — name, address, phone, email, hours, charges and delivery
   fee — in `/admin/settings`. The seeded values are marked demo precisely so they are never mistaken
   for the real restaurant's.
10. Add a scheduled job that calls the queue drain and the reservation reminders (see known gaps).

## 14. Security posture

- No database credential, gateway key, SMTP password or AI key is ever imported into a client
  component; `src/lib/env.ts` exposes only `NEXT_PUBLIC_APP_URL` and the poll interval through
  `publicEnv`.
- Passwords: bcrypt with per-hash salt, minimum 10 characters with mixed case, a digit and a
  common-word blocklist (`passwordProblem`). There is no default or shipped password anywhere.
- Rate limits on 14 endpoints — login, register, password reset start and complete, order submission,
  reservation create and cancel, chat and escalation, table join, bill request, gateway callback,
  guest payment initiation and the simulated-payment completion (`src/lib/auth/rate-limit.ts`), keyed
  by IP plus the identifier being attacked.
- **Cross-origin writes are refused centrally.** `route()` in `src/lib/api.ts` applies the same-origin
  check to every non-GET handler, so an individual handler cannot forget it; the only opt-out is
  `allowForeignOrigin`, used by the gateway callback, which is genuinely called by the payment
  provider's site and is authenticated by signature plus a server-side validation call instead.
  The allowed set is the request's own origin plus the configured `NEXT_PUBLIC_APP_URL` and the
  localhost/127.0.0.1 aliases — comparing against `request.url` alone would reject real customers
  behind a reverse proxy. Session cookies are additionally `SameSite=Lax`, `httpOnly` and `Secure`
  in production, and every mutation body must be JSON.
- Password reset tokens are single-use, hashed at rest, and expire; the response is identical whether
  or not the address exists.
- Public tokens (table QR, reservation lookup, order tracking, chat) are random, unguessable and
  scoped: knowing one never yields access to a different table, guest or staff record.
- Every zod schema bounds length, range and enum membership; a page size above 200 is refused rather
  than quietly clamped, because a silent clamp hides a buggy caller.
- Authorisation is checked in handlers and services, not in the router alone; unauthenticated JSON
  calls return `401 UNAUTHORIZED` and wrong-role calls `403 FORBIDDEN`.
- Finalised money is never deleted or edited in place: bills are voided with an audit row, payments
  are refunded with an audit row.

## 15. Known gaps — stated honestly

- **A takeaway or delivery order cannot be paid online.** The gateway is entered from a bill, and the
  only code that creates one raises it from a table session (`getOrCreateOpenBill(sessionId)` — the
  sole `bill.create` in the service). `Bill.orderId` and order-targeted counter payments exist, so a
  takeaway is settled in person, but nothing raises an order-only bill for a guest who wants to pay
  from the tracking page. Found by the Playwright suite and reported rather than papered over.
- **One live bill per visit.** Because a session resolves to a single bill, an order placed *after*
  that bill has taken money has nowhere to be billed: the paid document is correctly frozen, and the
  new order is left off it. The floor's answer today is to close the visit and open a fresh one;
  raising a second bill for the unbilled remainder needs `refreshBillLines` to scope its candidates to
  orders not already on a live bill, which this build does not do.
- **No scheduler is wired.** The notification queue drains fire-and-forget when a row is queued and
  on manual retry from `/admin/notifications`; nothing runs periodically. `RESERVATION_REMINDER` is a
  defined notification type that **no code currently produces**, so guests are not reminded
  automatically. A deployed instance needs a cron that calls `processNotificationQueue()` and the
  reminder scan.
- **Customer phone search is digit-matched.** Numbers are stored in one canonical trunk form, and
  search folds the country code and separators out of the query, but matching is still substring
  rather than normalised-equality — a search for `171234567` (one digit short) will not find the
  account it should.
- **Chat resolution is a deferred migration.** `/admin/chat` shows and escalates conversations; a
  dedicated resolved column/route is scheduled as task #22 and is not in this build.
- **Gateway coverage is sandbox-proven.** The SSLCommerz request/verification code paths are written
  and unit-covered, but no live merchant account was used during this build, so the callback contract
  must be re-verified against the gateway's current sandbox before go-live.
- **Media is served from disk**, not a CDN, through `/api/media/[file]`. Fine for one server; plan
  object storage for multi-instance deployments.

## 16. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `AUTH_SECRET is not set` | Add a 32+ character secret to `.env`; `npm run env:check` confirms. |
| `Refusing to run: connected to "dhaka_kabab"…` | Integration tests only use `TEST_DATABASE_URL`. Set it and re-run. |
| Port 55432 already in use | `npm run db:local:stop`, or set `DHAKA_KABAB_PG_PORT` and update both URLs. |
| Seed says `history: demo transactions already present` | Intentional: demo financial history is created once and never overwritten. |
| Menu prices show ৳0 | `pricePoisa` accepts 0 because a ৳0 customization delta is legitimate (a free option); on an *item* it reads as "this dish is free". Set the real price in `/admin/menu/[id]`. |
| `simulated payment` label on checkout | Expected without `SSLCOMMERZ_STORE_ID`/`API_KEY`; add them for a real gateway. |
