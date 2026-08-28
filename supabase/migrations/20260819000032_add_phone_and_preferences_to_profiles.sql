-- =============================================================================
-- Migration: 20260819000032_add_phone_and_preferences_to_profiles.sql
-- Description: Idempotently adds phone_number and preferences columns to public.profiles
--              to resolve PostgREST schema cache error PGRST204.
-- =============================================================================

-- 1. Idempotently add phone_number column
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- 2. Idempotently add preferences column
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
