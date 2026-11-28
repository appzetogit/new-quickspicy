-- The support inbox is ordered by last activity (updatedAt), not creation.
CREATE INDEX IF NOT EXISTS "food_chat_conversations_updatedAt_idx" ON "food_chat_conversations"("updatedAt" DESC);
