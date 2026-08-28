-- Migration: 20260825000046_ensure_tournament_closure_seals.sql
-- Description: Idempotently ensures the public.tournament_closure_seals table exists with canonical schema,
--              required indexes, RLS enabled, and public read policy to support tournament finalization.

-- 1. Ensure weigh_in_required column exists on tournaments table if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'weigh_in_required'
  ) THEN
    ALTER TABLE public.tournaments ADD COLUMN weigh_in_required BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 2. Create Master Tournament Closure Seals Table Idempotently
CREATE TABLE IF NOT EXISTS public.tournament_closure_seals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  seal_number TEXT NOT NULL UNIQUE,
  closure_hash TEXT NOT NULL,
  finalized_by UUID NOT NULL REFERENCES auth.users(id),
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  weigh_in_required BOOLEAN NOT NULL DEFAULT TRUE,
  total_bouts_completed INT NOT NULL DEFAULT 0,
  total_anyo_performances INT NOT NULL DEFAULT 0,
  total_participating_delegations INT NOT NULL DEFAULT 0,
  champion_team_name TEXT,
  final_standings_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  eligibility_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  signatories JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_closure_seals_tournament_id ON public.tournament_closure_seals(tournament_id);
CREATE INDEX IF NOT EXISTS idx_closure_seals_seal_number ON public.tournament_closure_seals(seal_number);

-- 4. Enable Row Level Security
ALTER TABLE public.tournament_closure_seals ENABLE ROW LEVEL SECURITY;

-- 5. Public read policy for closure transparency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'tournament_closure_seals' 
      AND policyname = 'Public read access to tournament closure seals'
  ) THEN
    CREATE POLICY "Public read access to tournament closure seals"
      ON public.tournament_closure_seals
      FOR SELECT
      USING (true);
  END IF;
END $$;
