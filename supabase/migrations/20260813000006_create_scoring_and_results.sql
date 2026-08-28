-- Migration: 20260813000006_create_scoring_and_results.sql
-- Description: Reconciled scoring rounds, match results, and system audit logs
-- Preserves existing: public.tournaments, public.tournament_snapshots, public.events, public.registrations, public.matches, public.courts, public.court_assignments

-- 1. Decision Type Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decision_type') THEN
    CREATE TYPE decision_type AS ENUM ('POINTS', 'TKO', 'DQ', 'DEFAULT', 'VOLUNTARY_DROP');
  END IF;
END $$;

-- 2. Winner Corner Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'corner_color') THEN
    CREATE TYPE corner_color AS ENUM ('RED', 'BLUE');
  END IF;
END $$;

-- 3. Scoring Rounds Table
CREATE TABLE IF NOT EXISTS public.scoring_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  red_score INT NOT NULL DEFAULT 0,
  blue_score INT NOT NULL DEFAULT 0,
  red_advantage BOOLEAN NOT NULL DEFAULT FALSE,
  blue_advantage BOOLEAN NOT NULL DEFAULT FALSE,
  winner_corner corner_color,
  judge_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scoring_rounds_match_round_unique UNIQUE (match_id, round_number)
);

CREATE INDEX IF NOT EXISTS scoring_rounds_match_id_idx ON public.scoring_rounds(match_id);
CREATE INDEX IF NOT EXISTS scoring_rounds_judge_id_idx ON public.scoring_rounds(judge_id);

-- 4. Match Results Table
CREATE TABLE IF NOT EXISTS public.match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  winner_registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE RESTRICT,
  decision_type decision_type NOT NULL DEFAULT 'POINTS',
  rounds_won_red INT NOT NULL DEFAULT 0,
  rounds_won_blue INT NOT NULL DEFAULT 0,
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_results_match_id_unique UNIQUE (match_id)
);

CREATE INDEX IF NOT EXISTS match_results_match_id_idx ON public.match_results(match_id);
CREATE INDEX IF NOT EXISTS match_results_winner_registration_id_idx ON public.match_results(winner_registration_id);
CREATE INDEX IF NOT EXISTS match_results_finalized_by_idx ON public.match_results(finalized_by);

-- 5. System Audit Logs Table (Append-Only Governance Ledger)
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_audit_logs_tournament_id_idx ON public.system_audit_logs(tournament_id);
CREATE INDEX IF NOT EXISTS system_audit_logs_actor_user_id_idx ON public.system_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS system_audit_logs_entity_type_id_idx ON public.system_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS system_audit_logs_created_at_idx ON public.system_audit_logs(created_at DESC);

-- 6. Updated At Triggers
DROP TRIGGER IF EXISTS set_scoring_rounds_updated_at ON public.scoring_rounds;
CREATE TRIGGER set_scoring_rounds_updated_at
  BEFORE UPDATE ON public.scoring_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_match_results_updated_at ON public.match_results;
CREATE TRIGGER set_match_results_updated_at
  BEFORE UPDATE ON public.match_results
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.scoring_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

-- 8. Scoring Rounds RLS Policies
DROP POLICY IF EXISTS "Scoring rounds viewable by authenticated users" ON public.scoring_rounds;
CREATE POLICY "Scoring rounds viewable by authenticated users"
  ON public.scoring_rounds FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super Admins can manage all scoring rounds" ON public.scoring_rounds;
CREATE POLICY "Super Admins can manage all scoring rounds"
  ON public.scoring_rounds FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 9. Match Results RLS Policies
DROP POLICY IF EXISTS "Match results viewable by authenticated users" ON public.match_results;
CREATE POLICY "Match results viewable by authenticated users"
  ON public.match_results FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super Admins can manage all match results" ON public.match_results;
CREATE POLICY "Super Admins can manage all match results"
  ON public.match_results FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 10. System Audit Logs RLS Policies (Append-Only Enforcement)
DROP POLICY IF EXISTS "Super Admins can view audit logs" ON public.system_audit_logs;
CREATE POLICY "Super Admins can view audit logs"
  ON public.system_audit_logs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.system_audit_logs;
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.system_audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- Explicitly disallow UPDATE and DELETE on audit logs for standard roles
-- (No UPDATE or DELETE policies created => default deny guarantees append-only immutability)
