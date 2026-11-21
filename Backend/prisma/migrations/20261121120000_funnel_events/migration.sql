-- Customer acquisition funnel events (Report Management -> Customer Funnel).
-- Hand-written and idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS "food_funnel_events" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "event" VARCHAR(32) NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "deviceId" VARCHAR(64),
    "userId" VARCHAR(24),
    "platform" VARCHAR(10) NOT NULL,
    "appVersion" VARCHAR(32),
    "zoneId" VARCHAR(24),
    "restaurantId" VARCHAR(24),
    "orderId" VARCHAR(24),
    "props" JSONB NOT NULL DEFAULT '{}',
    "source" VARCHAR(10) NOT NULL DEFAULT 'app',
    "dedupeKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_funnel_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "food_funnel_events_dedupeKey_key" ON "food_funnel_events"("dedupeKey");
CREATE INDEX IF NOT EXISTS "food_funnel_events_event_createdAt_idx" ON "food_funnel_events"("event", "createdAt");
CREATE INDEX IF NOT EXISTS "food_funnel_events_sessionId_idx" ON "food_funnel_events"("sessionId");
CREATE INDEX IF NOT EXISTS "food_funnel_events_createdAt_idx" ON "food_funnel_events"("createdAt");
CREATE INDEX IF NOT EXISTS "food_funnel_events_userId_createdAt_idx" ON "food_funnel_events"("userId", "createdAt");
