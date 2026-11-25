-- Zones written without a city link (the demo seeds and data imported after
-- 20260918090000_cities_and_admin_scope) kept only their typed city name, so
-- their cities never appeared in the city pickers (Add Deliveryman, Sub Admin).
-- Same rules as that migration's backfill, but only for zones with no link,
-- and an existing city with the same name is reused.

INSERT INTO "food_cities" ("name", "nameKey", "updatedAt")
SELECT CASE WHEN MIN(btrim(regexp_replace("city", '\s+', ' ', 'g'))) = lower(MIN(btrim(regexp_replace("city", '\s+', ' ', 'g'))))
            THEN initcap(MIN(btrim(regexp_replace("city", '\s+', ' ', 'g'))))
            ELSE MIN(btrim(regexp_replace("city", '\s+', ' ', 'g'))) END,
       lower(btrim(regexp_replace("city", '\s+', ' ', 'g'))),
       CURRENT_TIMESTAMP
FROM "food_zones"
WHERE "cityId" IS NULL AND btrim(coalesce("city", '')) <> ''
GROUP BY lower(btrim(regexp_replace("city", '\s+', ' ', 'g')))
ON CONFLICT ("nameKey") DO NOTHING;

UPDATE "food_zones" z SET "cityId" = c."id", "city" = c."name"
FROM "food_cities" c
WHERE z."cityId" IS NULL
  AND c."nameKey" = lower(btrim(regexp_replace(z."city", '\s+', ' ', 'g')));
