-- Migration: 20260813000004_create_domain_foundation.sql
-- Description: Reconciled foundational competition domain tables: registrations, matches, and match_status enum
-- Preserves existing: public.tournaments, public.tournament_snapshots, public.events

-- 1. Match Status Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_status') THEN
    CREATE TYPE match_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

-- 2. Athlete Registrations Table
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_name TEXT,
  weigh_in_weight NUMERIC(5,2),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT registrations_event_user_unique UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS registrations_event_id_idx ON public.registrations(event_id);
CREATE INDEX IF NOT EXISTS registrations_user_id_idx ON public.registrations(user_id);

-- 3. Matches Table
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  match_number INT NOT NULL,
  red_corner_registration_id UUID REFERENCES public.registrations(id) ON DELETE SET NULL,
  blue_corner_registration_id UUID REFERENCES public.registrations(id) ON DELETE SET NULL,
  winner_registration_id UUID REFERENCES public.registrations(id) ON DELETE SET NULL,
  status match_status NOT NULL DEFAULT 'SCHEDULED',
  scheduled_time TIMESTAMPTZ,
  court_identifier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT matches_corners_check CHECK (
    red_corner_registration_id IS NULL 
    OR blue_corner_registration_id IS NULL 
    OR red_corner_registration_id <> blue_corner_registration_id
  )
);

CREATE INDEX IF NOT EXISTS matches_event_id_idx ON public.matches(event_id);
CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
CREATE INDEX IF NOT EXISTS matches_event_round_match_idx ON public.matches(event_id, round_number, match_number);

-- 4. Updated At Triggers
DROP TRIGGER IF EXISTS set_registrations_updated_at ON public.registrations;
CREATE TRIGGER set_registrations_updated_at
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_matches_updated_at ON public.matches;
CREATE TRIGGER set_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. Registration Immutability Enforcement Function and Trigger
CREATE OR REPLACE FUNCTION public.enforce_registration_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Super Admins are exempt from athlete immutability constraints
  IF NOT public.is_super_admin(auth.uid()) THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'event_id is immutable for athlete registrations.';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id is immutable for athlete registrations.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

DROP TRIGGER IF EXISTS enforce_registration_immutability_trigger ON public.registrations;
CREATE TRIGGER enforce_registration_immutability_trigger
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_immutability();

-- 6. Enable Row Level Security
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies: Registrations
DROP POLICY IF EXISTS "Registrations viewable by authenticated users" ON public.registrations;
CREATE POLICY "Registrations viewable by authenticated users"
  ON public.registrations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Athletes can register themselves" ON public.registrations;
CREATE POLICY "Athletes can register themselves"
  ON public.registrations FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND is_approved = FALSE
    AND approved_by IS NULL
    AND weigh_in_weight IS NULL
  );

DROP POLICY IF EXISTS "Athletes can update unapproved registrations" ON public.registrations;
CREATE POLICY "Athletes can update unapproved registrations"
  ON public.registrations FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id 
    AND NOT is_approved
  )
  WITH CHECK (
    auth.uid() = user_id 
    AND NOT is_approved 
    AND approved_by IS NULL
    AND weigh_in_weight IS NULL
  );

DROP POLICY IF EXISTS "Super Admins can manage all registrations" ON public.registrations;
CREATE POLICY "Super Admins can manage all registrations"
  ON public.registrations FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 8. RLS Policies: Matches
DROP POLICY IF EXISTS "Matches viewable by authenticated users" ON public.matches;
CREATE POLICY "Matches viewable by authenticated users"
  ON public.matches FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super Admins can manage all matches" ON public.matches;
CREATE POLICY "Super Admins can manage all matches"
  ON public.matches FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
