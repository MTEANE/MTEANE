-- Migration 008: Remove plan tiers.
-- Rate limiting is now controlled globally by the RATE_LIMIT environment variable.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS plan;
