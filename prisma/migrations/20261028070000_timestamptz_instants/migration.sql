-- Every timestamp column becomes an instant.
--
-- Prisma's plain `DateTime` created `timestamp(3) without time zone`, so the
-- stored text was UTC wall-clock with nothing to say so. `USING ... AT TIME ZONE
-- 'UTC'` is what keeps those values honest: it re-reads the existing text as UTC
-- instead of letting Postgres assume the server's own zone, which would move
-- every recorded order, payment and bill by the session offset.

ALTER TABLE "audit_logs" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "auth_sessions" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "auth_sessions" ALTER COLUMN "expiresAt" TYPE timestamp(3) WITH TIME ZONE USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "bill_items" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "bills" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "bills" ALTER COLUMN "finalizedAt" TYPE timestamp(3) WITH TIME ZONE USING "finalizedAt" AT TIME ZONE 'UTC';
ALTER TABLE "bills" ALTER COLUMN "settledAt" TYPE timestamp(3) WITH TIME ZONE USING "settledAt" AT TIME ZONE 'UTC';
ALTER TABLE "bills" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "bills" ALTER COLUMN "voidedAt" TYPE timestamp(3) WITH TIME ZONE USING "voidedAt" AT TIME ZONE 'UTC';
ALTER TABLE "chat_conversations" ALTER COLUMN "escalatedAt" TYPE timestamp(3) WITH TIME ZONE USING "escalatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "chat_conversations" ALTER COLUMN "lastActiveAt" TYPE timestamp(3) WITH TIME ZONE USING "lastActiveAt" AT TIME ZONE 'UTC';
ALTER TABLE "chat_conversations" ALTER COLUMN "startedAt" TYPE timestamp(3) WITH TIME ZONE USING "startedAt" AT TIME ZONE 'UTC';
ALTER TABLE "chat_messages" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "document_counters" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_categories" ALTER COLUMN "archivedAt" TYPE timestamp(3) WITH TIME ZONE USING "archivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_categories" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_categories" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_items" ALTER COLUMN "archivedAt" TYPE timestamp(3) WITH TIME ZONE USING "archivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_items" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "menu_items" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "notifications" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "notifications" ALTER COLUMN "sentAt" TYPE timestamp(3) WITH TIME ZONE USING "sentAt" AT TIME ZONE 'UTC';
ALTER TABLE "notifications" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "order_items" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "order_status_events" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "cancelledAt" TYPE timestamp(3) WITH TIME ZONE USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "completedAt" TYPE timestamp(3) WITH TIME ZONE USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "confirmedAt" TYPE timestamp(3) WITH TIME ZONE USING "confirmedAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "preparingAt" TYPE timestamp(3) WITH TIME ZONE USING "preparingAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "readyAt" TYPE timestamp(3) WITH TIME ZONE USING "readyAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "servedAt" TYPE timestamp(3) WITH TIME ZONE USING "servedAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "expiresAt" TYPE timestamp(3) WITH TIME ZONE USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "usedAt" TYPE timestamp(3) WITH TIME ZONE USING "usedAt" AT TIME ZONE 'UTC';
ALTER TABLE "payment_events" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "payments" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "payments" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "payments" ALTER COLUMN "verifiedAt" TYPE timestamp(3) WITH TIME ZONE USING "verifiedAt" AT TIME ZONE 'UTC';
ALTER TABLE "refunds" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "refunds" ALTER COLUMN "processedAt" TYPE timestamp(3) WITH TIME ZONE USING "processedAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservation_table_assignments" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "cancelledAt" TYPE timestamp(3) WITH TIME ZONE USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "checkedInAt" TYPE timestamp(3) WITH TIME ZONE USING "checkedInAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "completedAt" TYPE timestamp(3) WITH TIME ZONE USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "confirmedAt" TYPE timestamp(3) WITH TIME ZONE USING "confirmedAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "noShowAt" TYPE timestamp(3) WITH TIME ZONE USING "noShowAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "startsAt" TYPE timestamp(3) WITH TIME ZONE USING "startsAt" AT TIME ZONE 'UTC';
ALTER TABLE "reservations" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "restaurant_settings" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "restaurant_settings" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "restaurant_tables" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "restaurant_tables" ALTER COLUMN "tokenRotatedAt" TYPE timestamp(3) WITH TIME ZONE USING "tokenRotatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "restaurant_tables" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "table_session_guests" ALTER COLUMN "joinedAt" TYPE timestamp(3) WITH TIME ZONE USING "joinedAt" AT TIME ZONE 'UTC';
ALTER TABLE "table_session_guests" ALTER COLUMN "lastSeenAt" TYPE timestamp(3) WITH TIME ZONE USING "lastSeenAt" AT TIME ZONE 'UTC';
ALTER TABLE "table_sessions" ALTER COLUMN "billRequestedAt" TYPE timestamp(3) WITH TIME ZONE USING "billRequestedAt" AT TIME ZONE 'UTC';
ALTER TABLE "table_sessions" ALTER COLUMN "closedAt" TYPE timestamp(3) WITH TIME ZONE USING "closedAt" AT TIME ZONE 'UTC';
ALTER TABLE "table_sessions" ALTER COLUMN "openedAt" TYPE timestamp(3) WITH TIME ZONE USING "openedAt" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE timestamp(3) WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "lastLoginAt" TYPE timestamp(3) WITH TIME ZONE USING "lastLoginAt" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE timestamp(3) WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC';
