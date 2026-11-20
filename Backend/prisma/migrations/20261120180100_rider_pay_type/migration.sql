-- Rider payment type: gig (paid per order, the default) or salaried.
DO $$ BEGIN
    CREATE TYPE "RiderPayType" AS ENUM ('gig', 'salaried');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "food_delivery_partners"
  ADD COLUMN IF NOT EXISTS "payType" "RiderPayType" NOT NULL DEFAULT 'gig';

-- Salaried rider incentive: how each delivered order of a salaried rider was
-- paid. 'salaried_covered' = one of the day's first N (salary covers it),
-- 'salaried_incentive' = order N+1 onward (normal pay).
ALTER TABLE "food_orders"
  ADD COLUMN IF NOT EXISTS "riderPayBasis" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "riderDaySeq" INTEGER,
  ADD COLUMN IF NOT EXISTS "riderPayWaived" DECIMAL(14,2) NOT NULL DEFAULT 0;

