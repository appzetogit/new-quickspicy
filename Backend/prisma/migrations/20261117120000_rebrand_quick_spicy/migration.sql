-- Rebrand: Minto Foods -> Quick Spicy.
--
-- companyName is the name the whole frontend renders (useCompanyName reads it
-- from business settings), and userThemeColor / userFontFamily drive the
-- customer app's theme. Moving the column defaults is what rebrands a fresh
-- install.
--
-- Only values that still hold the previous default are rewritten. Anything an
-- operator chose deliberately in the admin panel is left alone.
ALTER TABLE "food_business_settings" ALTER COLUMN "companyName" SET DEFAULT 'Quick Spicy';
ALTER TABLE "food_business_settings" ALTER COLUMN "email" SET DEFAULT 'quickspicyenterprises@gmail.com';
ALTER TABLE "food_business_settings" ALTER COLUMN "userThemeColor" SET DEFAULT '#EB590E';
ALTER TABLE "food_business_settings" ALTER COLUMN "userFontFamily" SET DEFAULT 'Outfit';

UPDATE "food_business_settings" SET "companyName" = 'Quick Spicy' WHERE "companyName" IN ('Minto Foods', 'Switcheats');
UPDATE "food_business_settings" SET "email" = 'quickspicyenterprises@gmail.com' WHERE "email" IN ('admin@mintofood.com', 'admin@switcheats.com');
UPDATE "food_business_settings" SET "userThemeColor" = '#EB590E' WHERE UPPER("userThemeColor") = '#FA0272';
UPDATE "food_business_settings" SET "userFontFamily" = 'Outfit' WHERE "userFontFamily" = 'Poppins';
