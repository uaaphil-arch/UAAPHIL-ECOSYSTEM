-- Migration: 20260813000005_create_courts_and_scheduling.sql
-- Description: Reconciled courts and match scheduling infrastructure
-- Preserves existing: public.tournaments, public.tournament_snapshots, public.events, public.registrations, public.matches

-- 1. Assignment Status Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE assignment_status AS ENUM ('ASSIGNED', 'LIVE', 'COMPLETED');
  END IF;
END $$;

-- 2. Courts Table
CREATE TABLE IF NOT EXISTS public.courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courts_tournament_identifier_unique UNIQUE (tournament_id, identifier)
);

CREATE INDEX IF NOT EXISTS courts_tournament_id_idx ON public.courts(tournament_id);
CREATE INDEX IF NOT EXISTS courts_is_active_idx ON public.courts(is_active);

-- 3. Court Assignments Table
CREATE TABLE IF NOT EXISTS public.court_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES public.courts(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status assignment_status NOT NULL DEFAULT 'ASSIGNED'
);

CREATE INDEX IF NOT EXISTS court_assignments_match_id_idx ON public.court_assignments(match_id);
CREATE INDEX IF NOT EXISTS court_assignments_court_id_idx ON public.court_assignments(court_id);
CREATE INDEX IF NOT EXISTS court_assignments_status_idx ON public.court_assignments(status);

-- 4. Live Court Concurrency Invariant: Exactly ONE match LIVE per court
CREATE UNIQUE INDEX IF NOT EXISTS court_assignments_single_live_idx
  ON public.court_assignments (court_id)
  WHERE (status = 'LIVE');

-- 5. Updated At Trigger for Courts
DROP TRIGGER IF EXISTS set_courts_updated_at ON public.courts;
CREATE TRIGGER set_courts_updated_at
  BEFORE UPDATE ON public.courts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_assignments ENABLE ROW LEVEL SECURITY;

-- 7. Courts RLS Policies
DROP POLICY IF EXISTS "Courts viewable by authenticated users" ON public.courts;
CREATE POLICY "Courts viewable by authenticated users"
  ON public.courts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super Admins can manage all courts" ON public.courts;
CREATE POLICY "Super Admins can manage all courts"
  ON public.courts FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 8. Court Assignments RLS Policies
DROP POLICY IF EXISTS "Court assignments viewable by authenticated users" ON public.court_assignments;
CREATE POLICY "Court assignments viewable by authenticated users"
  ON public.court_assignments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super Admins can manage all court assignments" ON public.court_assignments;
CREATE POLICY "Super Admins can manage all court assignments"
  ON public.court_assignments FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
