-- ============================================================================
-- MIGRATION: 20260823000043_reconcile_finalization_and_scoring_idempotency.sql
-- DESCRIPTION: Reconciles:
--   1. public.finalize_tournament: Fixes authorization schema check (removes legacy roles table join, uses is_admin_or_higher)
--   2. public.record_round_score: Adds ON CONFLICT (match_id, round_number) DO UPDATE for idempotent round scoring updates and retries
--   3. public.enforce_completed_tournament_immutability: Hardens trigger function with explicit SET search_path = public, pg_temp
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HARDEN TRIGGER FUNCTION: public.enforce_completed_tournament_immutability
-- ----------------------------------------------------------------------------
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 2. RECONCILE RPC: public.finalize_tournament
-- ----------------------------------------------------------------------------
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

  v_is_authorized := public.is_admin_or_higher(v_user_id);

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.finalize_tournament(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_tournament(UUID, JSONB, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RECONCILE RPC: public.record_round_score (Idempotent UPSERT Support)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_round_score(
  p_match_id UUID,
  p_round_number INT,
  p_red_score INT,
  p_blue_score INT,
  p_red_advantage BOOLEAN DEFAULT FALSE,
  p_blue_advantage BOOLEAN DEFAULT FALSE,
  p_winner_corner public.corner_color DEFAULT NULL,
  p_is_confirmed BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_score_id UUID;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Match Details
  SELECT m.*, ts.tournament_id AS event_tournament_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = p_match_id;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- Resolve court_id from active court_assignment
  SELECT ca.court_id INTO v_court_id
  FROM public.court_assignments ca
  WHERE ca.match_id = p_match_id AND ca.status = 'LIVE'::public.court_assignment_status
  LIMIT 1;

  IF v_court_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Match is not currently LIVE on any court.' USING ERRCODE = '40030';
  END IF;

  -- 3. Strict Scoring Authorization Gate:
  -- Admins, Organizer, or TABLE_OFFICIAL on assigned court.
  -- COURT_MANAGER is explicitly DENIED (p_allow_court_manager := FALSE).
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := v_court_id,
    p_allow_court_manager := FALSE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Only assigned Table Officials and Tournament Administrators can record round scores. Court Managers are not authorized to score.' USING ERRCODE = '40300';
  END IF;

  -- 4. Match Lifecycle Validation
  IF v_match.status <> 'LIVE'::public.match_status THEN
    RAISE EXCEPTION 'INVALID_STATE: Scores can only be recorded for LIVE matches. Current status: %', v_match.status USING ERRCODE = '40031';
  END IF;

  -- 5. Insert or Update Round Score Idempotently
  INSERT INTO public.scoring_rounds (
    match_id,
    round_number,
    red_score,
    blue_score,
    red_advantage,
    blue_advantage,
    winner_corner,
    judge_id,
    is_confirmed,
    updated_at
  ) VALUES (
    p_match_id,
    p_round_number,
    p_red_score,
    p_blue_score,
    COALESCE(p_red_advantage, FALSE),
    COALESCE(p_blue_advantage, FALSE),
    p_winner_corner,
    v_requester_id,
    COALESCE(p_is_confirmed, FALSE),
    NOW()
  )
  ON CONFLICT (match_id, round_number) DO UPDATE SET
    red_score = EXCLUDED.red_score,
    blue_score = EXCLUDED.blue_score,
    red_advantage = EXCLUDED.red_advantage,
    blue_advantage = EXCLUDED.blue_advantage,
    winner_corner = EXCLUDED.winner_corner,
    judge_id = EXCLUDED.judge_id,
    is_confirmed = EXCLUDED.is_confirmed,
    updated_at = NOW()
  RETURNING id INTO v_score_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'score_id', v_score_id,
    'match_id', p_match_id,
    'round_number', p_round_number,
    'red_score', p_red_score,
    'blue_score', p_blue_score,
    'recorded_by', v_requester_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_round_score(UUID, INT, INT, INT, BOOLEAN, BOOLEAN, public.corner_color, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_round_score(UUID, INT, INT, INT, BOOLEAN, BOOLEAN, public.corner_color, BOOLEAN) TO authenticated;
