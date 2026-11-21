-- Several card tags per restaurant, and a per-order packing charge.
-- Idempotent: safe to run again.

ALTER TABLE "food_restaurants" ADD COLUMN IF NOT EXISTS "highlightBadges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "food_restaurants" ADD COLUMN IF NOT EXISTS "packagingCharge" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Carry the single tag over as the first (and only) one. Only rows that have
-- a tag and no list yet, so a re-run never overwrites tags set since.
UPDATE "food_restaurants"
SET "highlightBadges" = ARRAY["highlightBadge"]::TEXT[]
WHERE "highlightBadge" IS NOT NULL
  AND btrim("highlightBadge") <> ''
  AND cardinality("highlightBadges") = 0;
