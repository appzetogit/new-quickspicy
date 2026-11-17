-- Phase 3: zone-restricted dispatch, targeted/recurring/tiered incentives,
-- weekly payout statements, per-document rider verification.

ALTER TABLE "food_zones" ADD COLUMN IF NOT EXISTS "ridersFromZoneOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "food_delivery_partners" ADD COLUMN IF NOT EXISTS "documentReviews" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "food_earning_addons"
  ADD COLUMN IF NOT EXISTS "zoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "cohortIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "recurrence" VARCHAR(8) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "autoCredit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tiers" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "food_earning_addon_history"
  ADD COLUMN IF NOT EXISTS "periodKey" VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "periodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tier" INTEGER NOT NULL DEFAULT 0;

-- One grant per offer, rider and period (was: per offer and rider). Existing
-- rows all have periodKey '', so they keep the old meaning.
DROP INDEX IF EXISTS "earning_addon_one_grant_per_partner";
CREATE UNIQUE INDEX "earning_addon_one_grant_per_partner"
  ON "food_earning_addon_history" ("offerId", "deliveryPartnerId", "periodKey")
  WHERE ("status" <> 'cancelled');

CREATE TABLE IF NOT EXISTS "food_payout_statements" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "entityType" VARCHAR(16) NOT NULL,
    "entityId" VARCHAR(24) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "earnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incentives" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashDeposited" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashInHand" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustmentNote" TEXT NOT NULL DEFAULT '',
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" VARCHAR(24),
    "paidAt" TIMESTAMP(3),
    "paidBy" VARCHAR(24),
    "payoutRef" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "settlementId" VARCHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "food_payout_statements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "food_payout_statements_entityType_entityId_periodStart_key"
  ON "food_payout_statements"("entityType", "entityId", "periodStart");
CREATE INDEX IF NOT EXISTS "food_payout_statements_status_periodStart_idx"
  ON "food_payout_statements"("status", "periodStart");
CREATE INDEX IF NOT EXISTS "food_payout_statements_entityType_entityId_periodStart_idx"
  ON "food_payout_statements"("entityType", "entityId", "periodStart" DESC);
