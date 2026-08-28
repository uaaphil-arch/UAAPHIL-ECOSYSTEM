-- Migration: 20260818000020_support_mixed_division_and_multi_weight.sql
-- Domain: Event Configuration Expansion (Phase 4)
-- Project: UAAPHIL Tournament System
-- Invariants:
--   1. Additive, safe, and backwards-compatible
--   2. Permits 'MIXED' / 'X' / 'M' / 'F' values in events and registration queries if constraint exists
--   3. Does NOT modify previously applied migrations (20260818000018 and 20260818000019)
--   4. Preserves 100% snapshot-first tournament lifecycle and RBAC

DO $$
BEGIN
  -- If there is a check constraint on events.gender, ensure it supports 'MIXED' / 'X'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
    AND conname = 'events_gender_check'
  ) THEN
    ALTER TABLE public.events DROP CONSTRAINT events_gender_check;
    ALTER TABLE public.events ADD CONSTRAINT events_gender_check CHECK (gender IN ('M', 'F', 'MIXED', 'X') OR gender IS NULL);
  END IF;
END $$;
