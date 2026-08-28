-- Migration: 20260817000016_harden_tournament_finalization_and_closure_seal.sql
-- Description: Hardens tournament finalization, enforces database-level immutability for completed tournaments,
--              creates the master closure seals table, and provides the atomic finalize_tournament RPC.

-- 1. Ensure weigh_in_required column exists on tournaments and tournament_snapshots if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'weigh_in_required'
  ) THEN
    ALTER TABLE public.tournaments ADD COLUMN weigh_in_required BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 2. Create Master Tournament Closure Seals Table
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

CREATE INDEX IF NOT EXISTS idx_closure_seals_tournament_id ON public.tournament_closure_seals(tournament_id);
CREATE INDEX IF NOT EXISTS idx_closure_seals_seal_number ON public.tournament_closure_seals(seal_number);

-- Enable RLS on tournament_closure_seals
ALTER TABLE public.tournament_closure_seals ENABLE ROW LEVEL SECURITY;

-- Everyone can read tournament closure seals (public transparency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tournament_closure_seals' AND policyname = 'Public read access to tournament closure seals'
  ) THEN
    CREATE POLICY "Public read access to tournament closure seals"
      ON public.tournament_closure_seals
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- 3. Database Trigger to enforce Immutability on Completed Tournament Records
CREATE OR REPLACE FUNCTION public.enforce_completed_tournament_immutability()
RETURNS TRIGGER AS $$
DECLARE
  v_tourney_id UUID;
  v_tourney_status TEXT;
BEGIN
  -- Determine tournament_id based on TG_TABLE_NAME
  IF TG_TABLE_NAME = 'tournaments' THEN
    IF OLD.status = 'COMPLETED' THEN
      RAISE EXCEPTION 'Tournament is finalized and sealed. Modifications to completed tournaments are strictly forbidden.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'matches' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSIF TG_TABLE_NAME = 'scoring_rounds' THEN
    SELECT m.tournament_id INTO v_tourney_id FROM public.matches m WHERE m.id = COALESCE(OLD.match_id, NEW.match_id);
  ELSIF TG_TABLE_NAME = 'anyo_performances' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSIF TG_TABLE_NAME = 'anyo_scores' THEN
    SELECT ap.tournament_id INTO v_tourney_id FROM public.anyo_performances ap WHERE ap.id = COALESCE(OLD.performance_id, NEW.performance_id);
  ELSIF TG_TABLE_NAME = 'registrations' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSIF TG_TABLE_NAME = 'court_assignments' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_tourney_id IS NOT NULL THEN
    SELECT status INTO v_tourney_status FROM public.tournaments WHERE id = v_tourney_id;
    IF v_tourney_status = 'COMPLETED' THEN
      RAISE EXCEPTION 'Tournament (%) is finalized and sealed. Database mutation on % is strictly forbidden.', v_tourney_id, TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to sensitive tournament tables
DO $$
BEGIN
  -- matches
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_matches') THEN
    CREATE TRIGGER trg_freeze_completed_matches
      BEFORE INSERT OR UPDATE OR DELETE ON public.matches
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;

  -- scoring_rounds
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_scoring_rounds') THEN
    CREATE TRIGGER trg_freeze_completed_scoring_rounds
      BEFORE INSERT OR UPDATE OR DELETE ON public.scoring_rounds
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;

  -- anyo_performances
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_anyo_performances') THEN
    CREATE TRIGGER trg_freeze_completed_anyo_performances
      BEFORE INSERT OR UPDATE OR DELETE ON public.anyo_performances
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;

  -- anyo_scores
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_anyo_scores') THEN
    CREATE TRIGGER trg_freeze_completed_anyo_scores
      BEFORE INSERT OR UPDATE OR DELETE ON public.anyo_scores
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;

  -- registrations
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_registrations') THEN
    CREATE TRIGGER trg_freeze_completed_registrations
      BEFORE INSERT OR UPDATE OR DELETE ON public.registrations
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;

  -- tournaments table status locking
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_freeze_completed_tournaments') THEN
    CREATE TRIGGER trg_freeze_completed_tournaments
      BEFORE UPDATE OR DELETE ON public.tournaments
      FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_tournament_immutability();
  END IF;
END $$;

-- 4. Atomic Preflight & Finalize RPC
CREATE OR REPLACE FUNCTION public.finalize_tournament(
  p_tournament_id UUID,
  p_signatories JSONB DEFAULT '[]'::jsonb,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_tourney RECORD;
  v_uncompleted_matches INT := 0;
  v_in_progress_matches INT := 0;
  v_unresolved_winners INT := 0;
  v_uncompleted_anyo INT := 0;
  v_unresolved_weighins INT := 0;
  v_total_completed_bouts INT := 0;
  v_total_completed_anyo INT := 0;
  v_total_delegations INT := 0;
  v_snapshot_locked BOOLEAN := FALSE;
  v_seal_number TEXT;
  v_closure_hash TEXT;
  v_standings_json JSONB := '[]'::jsonb;
  v_champion_team TEXT := 'TBD';
  v_eligibility_summary JSONB;
  v_seal_record RECORD;
BEGIN
  -- A. RBAC check (SUPER_ADMIN or ADMIN)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to finalize tournament.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id AND r.name IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: Only SUPER_ADMIN or ADMIN can finalize and seal a tournament.' USING ERRCODE = '42501';
  END IF;

  -- B. Fetch tournament record
  SELECT * INTO v_tourney FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament with ID % not found.', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tourney.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Tournament (%) is already finalized and sealed.', p_tournament_id USING ERRCODE = 'P0001';
  END IF;

  IF v_tourney.status != 'ONGOING' THEN
    RAISE EXCEPTION 'Tournament must be in ONGOING state to be finalized (current status: %).', v_tourney.status USING ERRCODE = 'P0001';
  END IF;

  -- C. Preflight Check: Snapshot exists and is locked
  SELECT is_locked INTO v_snapshot_locked
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id
  ORDER BY version DESC LIMIT 1;

  IF v_snapshot_locked IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Tournament snapshot is missing or not locked.' USING ERRCODE = 'P0001';
  END IF;

  -- D. Preflight Check: Matches
  SELECT COUNT(*) INTO v_uncompleted_matches
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND court_identifier != 'BYE'
    AND status != 'COMPLETED';

  IF v_uncompleted_matches > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % non-BYE matches remain uncompleted.', v_uncompleted_matches USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_in_progress_matches
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND status = 'IN_PROGRESS';

  IF v_in_progress_matches > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % matches are currently IN_PROGRESS on competition courts.', v_in_progress_matches USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_unresolved_winners
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND court_identifier != 'BYE'
    AND status = 'COMPLETED'
    AND winner_registration_id IS NULL;

  IF v_unresolved_winners > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % completed matches have unresolved winners.', v_unresolved_winners USING ERRCODE = 'P0001';
  END IF;

  -- E. Preflight Check: Anyo Performances
  SELECT COUNT(*) INTO v_uncompleted_anyo
  FROM public.anyo_performances
  WHERE tournament_id = p_tournament_id
    AND status != 'COMPLETED';

  IF v_uncompleted_anyo > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % Anyo performances remain uncompleted.', v_uncompleted_anyo USING ERRCODE = 'P0001';
  END IF;

  -- F. Preflight Check: Weigh-In Check (if weigh_in_required = true)
  IF COALESCE(v_tourney.weigh_in_required, TRUE) = TRUE THEN
    SELECT COUNT(*) INTO v_unresolved_weighins
    FROM public.registrations
    WHERE tournament_id = p_tournament_id
      AND weigh_in_status != 'PASSED'
      AND status = 'APPROVED';

    IF v_unresolved_weighins > 0 THEN
      RAISE EXCEPTION 'Finalization Preflight Failed: % approved athletes have unresolved weigh-in status (not PASSED).', v_unresolved_weighins USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- G. Compute Master Statistics
  SELECT COUNT(*) INTO v_total_completed_bouts
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND status = 'COMPLETED' AND court_identifier != 'BYE';

  SELECT COUNT(*) INTO v_total_completed_anyo
  FROM public.anyo_performances
  WHERE tournament_id = p_tournament_id AND status = 'COMPLETED';

  SELECT COUNT(DISTINCT COALESCE(school_club, team_name)) INTO v_total_delegations
  FROM public.registrations
  WHERE tournament_id = p_tournament_id AND status = 'APPROVED';

  -- H. Compute Standings / Medal Tally Snapshot
  BEGIN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'school_club', t.school_club,
          'gold_count', t.gold_count,
          'silver_count', t.silver_count,
          'bronze_count', t.bronze_count,
          'total_medals', t.total_medals,
          'rank_position', t.rank_position
        ) ORDER BY t.rank_position ASC
      ),
      '[]'::jsonb
    ) INTO v_standings_json
    FROM public.get_tournament_medal_tally(p_tournament_id) t;

    IF jsonb_array_length(v_standings_json) > 0 THEN
      v_champion_team := v_standings_json->0->>'school_club';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_standings_json := '[]'::jsonb;
  END;

  -- I. Eligibility summary
  v_eligibility_summary := jsonb_build_object(
    'weigh_in_required', COALESCE(v_tourney.weigh_in_required, TRUE),
    'total_delegations', v_total_delegations,
    'total_bouts_completed', v_total_completed_bouts,
    'total_anyo_completed', v_total_completed_anyo,
    'notes', p_notes
  );

  -- J. Generate Seal Number and Closure Hash
  v_seal_number := 'UAAPHIL-SEAL-' || to_char(timezone('utc'::text, now()), 'YYYYMMDD') || '-' || upper(substring(p_tournament_id::text from 1 for 8));
  v_closure_hash := encode(digest(p_tournament_id::text || v_seal_number || now()::text || v_total_completed_bouts::text, 'sha256'), 'hex');

  -- K. Insert Closure Seal Record
  INSERT INTO public.tournament_closure_seals (
    tournament_id,
    seal_number,
    closure_hash,
    finalized_by,
    finalized_at,
    weigh_in_required,
    total_bouts_completed,
    total_anyo_performances,
    total_participating_delegations,
    champion_team_name,
    final_standings_snapshot,
    eligibility_summary,
    signatories,
    metadata
  ) VALUES (
    p_tournament_id,
    v_seal_number,
    v_closure_hash,
    v_user_id,
    timezone('utc'::text, now()),
    COALESCE(v_tourney.weigh_in_required, TRUE),
    v_total_completed_bouts,
    v_total_completed_anyo,
    v_total_delegations,
    v_champion_team,
    v_standings_json,
    v_eligibility_summary,
    p_signatories,
    jsonb_build_object('finalized_at_epoch', extract(epoch from now()), 'client_notes', p_notes)
  )
  RETURNING * INTO v_seal_record;

  -- L. Transition Tournament Status to COMPLETED
  UPDATE public.tournaments
  SET status = 'COMPLETED',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_tournament_id;

  -- M. Return Seal Result
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'seal_id', v_seal_record.id,
    'seal_number', v_seal_number,
    'closure_hash', v_closure_hash,
    'finalized_at', v_seal_record.finalized_at,
    'weigh_in_required', v_seal_record.weigh_in_required,
    'total_bouts', v_total_completed_bouts,
    'total_anyo', v_total_completed_anyo,
    'champion_team', v_champion_team,
    'status', 'COMPLETED'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
