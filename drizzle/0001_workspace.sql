-- Run explicitly with the migration owner before deploying. Never runs on requests.
CREATE TABLE IF NOT EXISTS ieum_workspaces (
  id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- This prototype uses a locked aggregate per workspace. Normalized per-entity
-- tables, database roles/RLS and scale benchmarks are rollout work, not claimed.
