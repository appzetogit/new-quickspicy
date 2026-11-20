-- Ticket status: admins can flag a ticket for follow-up.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'flagged';

-- Customer and rider bans carry a reason, shown to them at login.
ALTER TABLE "food_users"
  ADD COLUMN IF NOT EXISTS "banReason" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);

ALTER TABLE "food_delivery_partners"
  ADD COLUMN IF NOT EXISTS "banReason" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);

-- Status history for customer and restaurant support tickets.
CREATE TABLE IF NOT EXISTS "food_support_ticket_status_history" (
    "id" VARCHAR(24) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "ticketSource" VARCHAR(16) NOT NULL DEFAULT 'user',
    "ticketId" VARCHAR(24) NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "changedBy" VARCHAR(24),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_support_ticket_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "food_ticket_status_history_ticket_idx"
  ON "food_support_ticket_status_history"("ticketSource", "ticketId", "createdAt");
