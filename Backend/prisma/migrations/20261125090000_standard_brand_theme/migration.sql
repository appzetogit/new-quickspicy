-- One Quick Spicy theme (Deep Orange #E64100, Poppins) for the customer,
-- restaurant and delivery apps and the admin panel, matching the mobile apps.
-- Only values still holding an earlier default are rewritten; a colour an
-- operator picked by hand in the admin panel is left alone.
ALTER TABLE "food_business_settings" ALTER COLUMN "userThemeColor" SET DEFAULT '#E64100';
ALTER TABLE "food_business_settings" ALTER COLUMN "userFontFamily" SET DEFAULT 'Poppins';
ALTER TABLE "food_business_settings" ALTER COLUMN "restaurantThemeColor" SET DEFAULT '#E64100';
ALTER TABLE "food_business_settings" ALTER COLUMN "deliveryThemeColor" SET DEFAULT '#E64100';

UPDATE "food_business_settings" SET "userThemeColor" = '#E64100' WHERE UPPER("userThemeColor") IN ('#EB590E', '#FA0272');
UPDATE "food_business_settings" SET "userFontFamily" = 'Poppins' WHERE "userFontFamily" = 'Outfit';
UPDATE "food_business_settings" SET "restaurantThemeColor" = '#E64100' WHERE UPPER("restaurantThemeColor") = '#2563EB';
UPDATE "food_business_settings" SET "deliveryThemeColor" = '#E64100' WHERE UPPER("deliveryThemeColor") = '#00B761';
