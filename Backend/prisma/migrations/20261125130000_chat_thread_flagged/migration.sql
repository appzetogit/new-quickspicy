-- Live Chat threads get the same Flag status support tickets have.
-- Additive only: existing rows and app builds that send open/in_progress/closed
-- are unaffected.
ALTER TYPE "ChatThreadStatus" ADD VALUE IF NOT EXISTS 'flagged';
