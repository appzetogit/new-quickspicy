CREATE TABLE IF NOT EXISTS "food_platform_settings" (
    "key" VARCHAR(48) NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" VARCHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "food_platform_settings_pkey" PRIMARY KEY ("key")
);
