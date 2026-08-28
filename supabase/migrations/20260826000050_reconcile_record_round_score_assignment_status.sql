-- ============================================================================
-- MIGRATION: 20260826000050_reconcile_record_round_score_assignment_status.sql
-- Description: Reconcile public.record_round_score to use the canonical
--              public.assignment_status enum ('LIVE'::public.assignment_status)
--              instead of the phantom public.court_assignment_status type reference.
-- ============================================================================

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

  -- Resolve court_id from active court_assignment using canonical assignment_status
  SELECT ca.court_id INTO v_court_id
  FROM public.court_assignments ca
  WHERE ca.match_id = p_match_id AND ca.status = 'LIVE'::public.assignment_status
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
