-- Outlets of one brand, and carts shared by link.

ALTER TABLE "food_restaurants" ADD COLUMN "outletGroupId" VARCHAR(24);

CREATE TABLE "food_shared_carts" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "token" VARCHAR(24) NOT NULL,
    "sharedByUserId" VARCHAR(24) NOT NULL,
    "restaurantId" VARCHAR(24) NOT NULL,
    "restaurantName" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL DEFAULT '[]',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "importCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_shared_carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "food_shared_carts_token_key" ON "food_shared_carts"("token");
CREATE INDEX "food_shared_carts_sharedByUserId_createdAt_idx" ON "food_shared_carts"("sharedByUserId", "createdAt");
CREATE INDEX "food_shared_carts_expiresAt_idx" ON "food_shared_carts"("expiresAt");
