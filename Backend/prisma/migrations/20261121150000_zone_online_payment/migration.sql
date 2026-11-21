-- Per-zone online payment switch. Null follows the platform, which is on, so
-- every existing zone keeps taking online payments until an admin says no.
-- Idempotent: safe to run again.

ALTER TABLE "food_zones" ADD COLUMN IF NOT EXISTS "onlinePaymentEnabled" BOOLEAN;
