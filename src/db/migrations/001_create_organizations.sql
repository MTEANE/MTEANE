-- Migration 001: Create organizations table
-- Manages multi-tenant organizations

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index on slug for quick lookups by org identifier
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
