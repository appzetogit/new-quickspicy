-- Egg (eggetarian) as a third dish diet beside Veg and Non-Veg.
-- Idempotent; the new value is not used inside this migration, so it is safe
-- in Prisma's transaction on PostgreSQL 12+.
ALTER TYPE "FoodType" ADD VALUE IF NOT EXISTS 'Egg';
