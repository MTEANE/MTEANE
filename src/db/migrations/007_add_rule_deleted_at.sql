-- Migration 007: Track deleted rules separately from paused rules.
-- Deleted rules are hidden from normal rule management while preserving rows for action log joins.

ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_rules_org_event;

CREATE INDEX IF NOT EXISTS idx_rules_org_event
  ON rules(org_id, event_type)
  WHERE is_active = true AND deleted_at IS NULL;
