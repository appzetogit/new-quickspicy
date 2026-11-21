-- Order lines record the dish's diet (Veg / Egg / Non-Veg). isVeg stays as is;
-- on its own it shows Egg dishes as non-veg. Idempotent.
ALTER TABLE "food_order_items" ADD COLUMN IF NOT EXISTS "foodType" "FoodType";

-- Backfill from the dish where it still exists...
UPDATE "food_order_items" AS oi
SET "foodType" = f."foodType"
FROM "food_items" AS f
WHERE oi."foodType" IS NULL
  AND f."id" = oi."itemId";

-- ...else (dish deleted, or the line is an add-on) from the recorded isVeg.
UPDATE "food_order_items"
SET "foodType" = CASE WHEN "isVeg" THEN 'Veg'::"FoodType" ELSE 'Non-Veg'::"FoodType" END
WHERE "foodType" IS NULL;
