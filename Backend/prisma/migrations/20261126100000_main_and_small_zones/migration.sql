-- Main zones and small zones; rider cohorts retired.
--
-- A zone with a parent is a small zone inside a main zone. Every existing zone
-- has no parent, so it is a main zone with no small zones and behaves exactly
-- as before.

ALTER TABLE "food_zones" ADD COLUMN "parentZoneId" VARCHAR(24);
ALTER TABLE "food_zones"
    ADD CONSTRAINT "food_zones_parentZoneId_fkey"
    FOREIGN KEY ("parentZoneId") REFERENCES "food_zones"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "food_zones_parentZoneId_idx" ON "food_zones"("parentZoneId");
-- A zone cannot be its own main zone.
ALTER TABLE "food_zones"
    ADD CONSTRAINT "food_zones_parent_not_self" CHECK ("parentZoneId" IS NULL OR "parentZoneId" <> "id");

-- The zones a rider serves besides their home zone.
ALTER TABLE "food_delivery_partners" ADD COLUMN "serviceZoneIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Riders keep the zones their active cohort gave them.
UPDATE "food_delivery_partners" p
SET "serviceZoneIds" = ARRAY(
        SELECT DISTINCT z FROM unnest(c."zoneIds") AS z
        WHERE z IS NOT NULL AND z <> coalesce(p."zoneId", '')
    )
FROM "food_rider_cohorts" c
WHERE p."cohortId" = c."id" AND c."isActive" = true;

-- Earning offers aimed at cohorts are aimed at those cohorts' zones instead.
UPDATE "food_earning_addons" a
SET "zoneIds" = ARRAY(
        SELECT DISTINCT z FROM (
            SELECT unnest(a."zoneIds") AS z
            UNION
            SELECT unnest(c."zoneIds") FROM "food_rider_cohorts" c WHERE c."id" = ANY(a."cohortIds")
        ) s WHERE z IS NOT NULL
    ),
    "cohortIds" = ARRAY[]::TEXT[]
WHERE cardinality(a."cohortIds") > 0;
