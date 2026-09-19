-- =============================================================================
-- Migration: Add Lead Summary & Concurrency Tracking Fields to Sessions
-- =============================================================================

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS summary_email_id TEXT NULL,
ADD COLUMN IF NOT EXISTS summary_version INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS summary_status TEXT NOT NULL DEFAULT 'not_sent';

-- Apply check constraint safely if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_summary_status_check'
  ) THEN
    ALTER TABLE sessions
    ADD CONSTRAINT sessions_summary_status_check
    CHECK (summary_status IN ('not_sent', 'pending', 'sent', 'failed'));
  END IF;
END $$;
