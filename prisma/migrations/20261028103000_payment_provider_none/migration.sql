-- An installation that has not chosen a payment gateway now takes no online payment.
--
-- The column used to default to `simulated`, the development stand-in, so a fresh
-- database looked able to take payments while every cent it recorded was pretend
-- money. `none` contacts no gateway at all: the counter keeps every bill until an
-- owner names one.
--
-- Rows already written are left alone, including a development database that is
-- deliberately on the simulated gateway. Nothing here can move real money either way.

ALTER TABLE "restaurant_settings" ALTER COLUMN "paymentProvider" SET DEFAULT 'none';
