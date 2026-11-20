-- Coupons limited to zones and/or cities. Both empty = everywhere.
ALTER TABLE "food_offers"
  ADD COLUMN IF NOT EXISTS "zoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "cityIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Per-zone referral rewards/limits; null fields fall back to food_referral_settings.
CREATE TABLE IF NOT EXISTS "food_referral_zone_settings" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "zoneId" VARCHAR(24) NOT NULL,
    "referralRewardUser" DECIMAL(14,2),
    "referralRewardDelivery" DECIMAL(14,2),
    "referralLimitUser" INTEGER,
    "referralLimitDelivery" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "food_referral_zone_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "food_referral_zone_settings_zoneId_key"
  ON "food_referral_zone_settings"("zoneId");
