-- ============================================================================
-- Migration: 20260830000063_harden_assign_match_to_court_concurrency.sql
-- Description:
--   1. Harden public.assign_match_to_court against concurrent stale-state races
--      by acquiring a row-level lock strictly on the target match (FOR UPDATE OF m)
--      prior to lifecycle validation and assignment relocation/upsert.
--   2. Enforce database-level invariant: at most ONE active court assignment
--      (status IN ('ASSIGNED', 'LIVE')) per match via a partial unique index.
-- ============================================================================

-- ============================================================================
-- 1. HARDEN RPC: public.assign_match_to_court (Match Row-Locking Concurrency)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_match_to_court(
  p_match_id UUID,
  p_court_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court RECORD;
  v_is_authorized BOOLEAN := FALSE;
  v_assignment_id UUID;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Match Details and Lock Target Match Row
  -- FOR UPDATE OF m ensures strictly the match row is locked, serializing
  -- concurrent dispatches, starts, and completions without locking snapshots or events.
  SELECT m.*, ts.tournament_id AS event_tournament_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = p_match_id
  FOR UPDATE OF m;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Fetch Court Details
  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id;

  IF v_court.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist.' USING ERRCODE = '40401';
  END IF;

  -- Verify Tournament Alignment
  IF v_court.tournament_id <> v_match.event_tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Court and match belong to different tournaments.' USING ERRCODE = '40301';
  END IF;

  -- 4. Authorize Requester: Admins, Organizer, or Event COURT_MANAGER
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := NULL,
    p_allow_court_manager := TRUE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not authorized to dispatch matches for this event.' USING ERRCODE = '40300';
  END IF;

  -- 5. Match Pre-Conditions Check (Evaluated against locked current match state)
  IF v_match.status NOT IN ('SCHEDULED'::public.match_status, 'PENDING'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Only SCHEDULED or PENDING matches can be dispatched to a court. Current: %', v_match.status USING ERRCODE = '40010';
  END IF;

  IF v_match.red_corner_registration_id IS NULL OR v_match.blue_corner_registration_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MATCH: Match participants are not fully resolved.' USING ERRCODE = '40011';
  END IF;

  -- 6. Cancel or update any existing assigned court assignment for this match
  SELECT id INTO v_assignment_id
  FROM public.court_assignments
  WHERE match_id = p_match_id AND status = 'ASSIGNED'::public.assignment_status
  LIMIT 1;

  IF v_assignment_id IS NOT NULL THEN
    UPDATE public.court_assignments
    SET court_id = p_court_id,
        assigned_by = v_requester_id,
        assigned_at = NOW()
    WHERE id = v_assignment_id;
  ELSE
    INSERT INTO public.court_assignments (
      court_id,
      match_id,
      status,
      assigned_at,
      assigned_by
    ) VALUES (
      p_court_id,
      p_match_id,
      'ASSIGNED'::public.assignment_status,
      NOW(),
      v_requester_id
    )
    RETURNING id INTO v_assignment_id;
  END IF;

  -- Update court identifier on match record
  UPDATE public.matches
  SET court_identifier = v_court.identifier,
      status = 'SCHEDULED'::public.match_status,
      updated_at = NOW()
  WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', v_assignment_id,
    'match_id', p_match_id,
    'court_id', p_court_id,
    'status', 'ASSIGNED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_match_to_court(UUID, UUID) TO authenticated, service_role;

-- ============================================================================
-- 2. STORAGE-ENGINE INVARIANT: Single Active Court Assignment Per Match
-- ============================================================================
-- Ensures a single match cannot possess more than ONE active court_assignments record
-- across ASSIGNED and LIVE states at any time.
CREATE UNIQUE INDEX IF NOT EXISTS court_assignments_single_active_match_idx
  ON public.court_assignments (match_id)
  WHERE (status IN ('ASSIGNED'::public.assignment_status, 'LIVE'::public.assignment_status));
