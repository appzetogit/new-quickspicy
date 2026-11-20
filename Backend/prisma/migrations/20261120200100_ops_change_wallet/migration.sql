-- Running-late notices, change-to-wallet requests and company UPI collections.
-- Hand-written and idempotent: safe to run twice.

-- Running late (orderDelay.service.js)
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "promisedDeliveryAt" TIMESTAMP(3);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayReason" VARCHAR(20);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayNote" VARCHAR(200);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayExtraMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayedUntil" TIMESTAMP(3);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayReportedAt" TIMESTAMP(3);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayReportedBy" VARCHAR(20);
ALTER TABLE "food_orders" ADD COLUMN IF NOT EXISTS "delayAutoNoticeAt" TIMESTAMP(3);

-- Orders already running carry an ETA; take it as what was promised so the
-- watchdog has something to measure against from the first run.
UPDATE "food_orders"
   SET "promisedDeliveryAt" = "estimatedDeliveryAt"
 WHERE "promisedDeliveryAt" IS NULL
   AND "estimatedDeliveryAt" IS NOT NULL
   AND "orderStatus" IN ('created','confirmed','preparing','ready_for_pickup','reached_pickup','picked_up','reached_drop');

-- Change to wallet
CREATE TABLE IF NOT EXISTS "food_change_credits" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "orderId" VARCHAR(24) NOT NULL,
    "deliveryPartnerId" VARCHAR(24) NOT NULL,
    "userId" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cashCollected" DECIMAL(14,2) NOT NULL,
    "orderCashDue" DECIMAL(14,2) NOT NULL,
    "riderNote" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "rejectReason" VARCHAR(300),
    "reviewedById" VARCHAR(24),
    "reviewedAt" TIMESTAMP(3),
    "walletTxnId" VARCHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_change_credits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "food_change_credits_orderId_key" ON "food_change_credits"("orderId");
CREATE INDEX IF NOT EXISTS "food_change_credits_status_createdAt_idx" ON "food_change_credits"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "food_change_credits_deliveryPartnerId_status_idx" ON "food_change_credits"("deliveryPartnerId", "status");

DO $$ BEGIN
    ALTER TABLE "food_change_credits"
        ADD CONSTRAINT "food_change_credits_amount_check" CHECK ("amount" > 0 AND "amount" <= "cashCollected");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Company UPI collections
CREATE TABLE IF NOT EXISTS "food_upi_collections" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "orderId" VARCHAR(24) NOT NULL,
    "deliveryPartnerId" VARCHAR(24),
    "amount" DECIMAL(14,2) NOT NULL,
    "upiId" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'awaiting_payment',
    "utr" VARCHAR(40),
    "confirmedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" VARCHAR(24),
    "reconcileNote" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_upi_collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "food_upi_collections_orderId_key" ON "food_upi_collections"("orderId");
CREATE INDEX IF NOT EXISTS "food_upi_collections_status_createdAt_idx" ON "food_upi_collections"("status", "createdAt");
