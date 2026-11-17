-- Phase 1 foundations: business verticals, rider cohorts, Telugu text.

-- Verticals ------------------------------------------------------------------
CREATE TABLE "food_verticals" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameTe" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "food_verticals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "food_verticals_name_key" ON "food_verticals"("name");
CREATE UNIQUE INDEX "food_verticals_slug_key" ON "food_verticals"("slug");
CREATE INDEX "food_verticals_isActive_sortOrder_idx" ON "food_verticals"("isActive", "sortOrder");

ALTER TABLE "food_restaurants" ADD COLUMN "verticalIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "food_categories" ADD COLUMN "nameTe" TEXT NOT NULL DEFAULT '';
ALTER TABLE "food_categories" ADD COLUMN "verticalId" VARCHAR(24);

ALTER TABLE "food_items" ADD COLUMN "nameTe" TEXT NOT NULL DEFAULT '';
ALTER TABLE "food_items" ADD COLUMN "descriptionTe" TEXT NOT NULL DEFAULT '';
ALTER TABLE "food_items" ADD COLUMN "verticalId" VARCHAR(24);

INSERT INTO "food_verticals" ("name", "slug", "nameTe", "description", "isDefault", "sortOrder", "updatedAt")
VALUES
    ('Food', 'food', 'ఆహారం', 'Restaurants and food outlets', true, 0, CURRENT_TIMESTAMP),
    ('Home Food', 'home food', 'ఇంటి భోజనం', 'Homemade food from home kitchens', false, 1, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Rider cohorts --------------------------------------------------------------
CREATE TABLE "food_rider_cohorts" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "zoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "food_rider_cohorts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "food_rider_cohorts_name_key" ON "food_rider_cohorts"("name");
CREATE INDEX "food_rider_cohorts_isActive_sortOrder_idx" ON "food_rider_cohorts"("isActive", "sortOrder");

ALTER TABLE "food_delivery_partners" ADD COLUMN "cohortId" VARCHAR(24);

-- Customer language ------------------------------------------------------------
ALTER TABLE "food_users" ADD COLUMN "preferredLanguage" VARCHAR(5) NOT NULL DEFAULT 'en';
