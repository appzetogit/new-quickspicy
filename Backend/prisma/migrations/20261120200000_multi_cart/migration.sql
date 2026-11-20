-- Multiple carts: one cart per (customer, restaurant) instead of one per customer.
--
-- Hand-written and idempotent. No cart rows are dropped or rewritten: every
-- existing cart already belongs to one customer and one restaurant (the web and
-- app only ever allowed a single restaurant per cart), so each existing row
-- simply becomes that customer's cart for that restaurant. The old unique key
-- on "userId" is widened to ("userId", "restaurantId"); it cannot conflict
-- because the old key was stricter.

-- 1. Add the new key first so carts are never without a uniqueness guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS "food_user_carts_userId_restaurantId_key"
    ON "food_user_carts"("userId", "restaurantId");

-- 2. Drop the one-cart-per-customer key.
DROP INDEX IF EXISTS "food_user_carts_userId_key";

-- 3. A customer's carts, newest first (the floating carts list).
CREATE INDEX IF NOT EXISTS "food_user_carts_userId_updatedAt_idx"
    ON "food_user_carts"("userId", "updatedAt" DESC);
