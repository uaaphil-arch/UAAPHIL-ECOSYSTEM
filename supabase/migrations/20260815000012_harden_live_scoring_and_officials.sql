-- Migration: 20260815000012_harden_live_scoring_and_officials.sql
-- Description: Gate O-33 live competition and scoring hardening
-- 1. Helper function to check if a user is an authorized official for an event/tournament
-- 2. Update assign_match_to_court, start_court_match, complete_court_match, cancel_match_assignment RPCs to allow event-scoped officials (COURT_MANAGER, TABLE_OFFICIAL)
-- 3. Create record_round_score RPC to persist live round scores securely to public.scoring_rounds with full role and assignment validation
-- 4. Enable RLS and add safe select/manage policies

-- 1. Function to check if a user is an authorized tournament manager/official
CREATE OR REPLACE FUNCTION public.is_authorized_tournament_official(
  p_user_id UUID,
  p_tournament_id UUID,
  p_event_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_perm_role BOOLEAN;
  v_has_event_assignment BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- A. Check permanent admin / organizer roles
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = p_user_id
    AND p.status = 'ACTIVE'
    AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  ) INTO v_has_perm_role;

  IF v_has_perm_role THEN
    RETURN TRUE;
  END IF;

  -- B. Check event-scoped role assignments in public.event_assignments
  IF p_tournament_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 
      FROM public.event_assignments ea
      JOIN public.profiles p ON p.id = ea.user_id
      WHERE ea.user_id = p_user_id
      AND ea.tournament_id = p_tournament_id
      AND (p_event_id IS NULL OR ea.event_id IS NULL OR ea.event_id = p_event_id)
      AND ea.role IN ('COURT_MANAGER', 'TABLE_OFFICIAL')
      AND p.status = 'ACTIVE'
    ) INTO v_has_event_assignment;

    IF v_has_event_assignment THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- 2. Hardened RPC: RECORD ROUND SCORE
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
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_is_authorized BOOLEAN;
  v_round_id UUID;
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Match Details & Status
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_match.status NOT IN ('IN_PROGRESS', 'SCHEDULED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Scores can only be updated for active or in-progress matches'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization Check (Permanent roles or Event-Scoped Officials)
  v_is_authorized := public.is_authorized_tournament_official(
    v_requester_id,
    v_match.tournament_id,
    v_match.event_id
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not have official authority for this match or tournament'
      USING ERRCODE = '40300';
  END IF;

  -- 4. Validate Inputs
  IF p_round_number < 1 OR p_round_number > 10 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Round number out of range'
      USING ERRCODE = '22023';
  END IF;

  IF p_red_score < 0 OR p_blue_score < 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Scores cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Upsert Round Score Atomically
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
    p_red_advantage,
    p_blue_advantage,
    p_winner_corner,
    v_requester_id,
    p_is_confirmed,
    timezone('utc'::text, now())
  )
  ON CONFLICT (match_id, round_number)
  DO UPDATE SET
    red_score = EXCLUDED.red_score,
    blue_score = EXCLUDED.blue_score,
    red_advantage = EXCLUDED.red_advantage,
    blue_advantage = EXCLUDED.blue_advantage,
    winner_corner = EXCLUDED.winner_corner,
    judge_id = EXCLUDED.judge_id,
    is_confirmed = EXCLUDED.is_confirmed,
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_round_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'round_id', v_round_id,
    'match_id', p_match_id,
    'round_number', p_round_number,
    'red_score', p_red_score,
    'blue_score', p_blue_score,
    'is_confirmed', p_is_confirmed
  );
END;
$$;

-- 3. Update ASSIGN_MATCH_TO_COURT with event official validation
CREATE OR REPLACE FUNCTION public.assign_match_to_court(
  p_match_id UUID,
  p_court_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role TEXT;
  v_match RECORD;
  v_court RECORD;
  v_existing_assignment RECORD;
  v_new_assignment_id UUID;
BEGIN
  -- 1. Authentication & Role Validation
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock & Validate Match
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_match.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only SCHEDULED matches can be assigned to a court'
      USING ERRCODE = '22000';
  END IF;

  IF v_match.red_corner_registration_id IS NULL OR v_match.blue_corner_registration_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Match cannot be assigned until both corners are populated'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock & Validate Court
  SELECT *
  INTO v_court
  FROM public.courts
  WHERE id = p_court_id
  FOR UPDATE;

  IF v_court.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_court.is_active THEN
    RAISE EXCEPTION 'INVALID_STATE: Court is inactive'
      USING ERRCODE = '22000';
  END IF;

  IF v_match.tournament_id <> v_court.tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Match and court belong to different tournaments'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Check Authorization
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_court.tournament_id, v_match.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not have authority to assign matches on this tournament court'
      USING ERRCODE = '40300';
  END IF;

  -- 5. Concurrency Check: Verify match is not already assigned
  SELECT *
  INTO v_existing_assignment
  FROM public.court_assignments
  WHERE match_id = p_match_id
  AND status IN ('ASSIGNED', 'LIVE')
  LIMIT 1;

  IF v_existing_assignment.id IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: Match is already assigned to a court (Status: %)', v_existing_assignment.status
      USING ERRCODE = '23505';
  END IF;

  -- 6. Insert Court Assignment
  INSERT INTO public.court_assignments (
    match_id,
    court_id,
    assigned_by,
    status,
    assigned_at
  ) VALUES (
    p_match_id,
    p_court_id,
    v_requester_id,
    'ASSIGNED',
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_new_assignment_id;

  -- 7. Update Match with Court Identifier
  UPDATE public.matches
  SET 
    court_identifier = v_court.identifier,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_match_id;

  -- 8. Audit Log
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    tournament_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    'OFFICIAL',
    'ASSIGN_MATCH_TO_COURT',
    'COURT_ASSIGNMENT',
    v_new_assignment_id,
    v_court.tournament_id,
    jsonb_build_object(
      'match_id', p_match_id,
      'court_id', p_court_id,
      'court_identifier', v_court.identifier
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', v_new_assignment_id,
    'match_id', p_match_id,
    'court_id', p_court_id,
    'court_identifier', v_court.identifier,
    'status', 'ASSIGNED'
  );
END;
$$;

-- 4. Update START_COURT_MATCH with event official validation
CREATE OR REPLACE FUNCTION public.start_court_match(
  p_court_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_assignment RECORD;
  v_match RECORD;
  v_court RECORD;
  v_other_live_assignment RECORD;
BEGIN
  -- 1. Authentication & Role Validation
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock & Validate Assignment
  SELECT *
  INTO v_assignment
  FROM public.court_assignments
  WHERE id = p_court_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court assignment does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_assignment.status <> 'ASSIGNED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only ASSIGNED court assignments can be transitioned to LIVE'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock Match & Court
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = v_assignment.match_id
  FOR UPDATE;

  SELECT *
  INTO v_court
  FROM public.courts
  WHERE id = v_assignment.court_id
  FOR UPDATE;

  -- 4. Check Authorization
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_court.tournament_id, v_match.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not have authority to start matches on this tournament court'
      USING ERRCODE = '40300';
  END IF;

  -- 5. Invariant: Exactly ONE LIVE match per court
  SELECT *
  INTO v_other_live_assignment
  FROM public.court_assignments
  WHERE court_id = v_assignment.court_id
  AND status = 'LIVE'
  AND id <> p_court_assignment_id
  LIMIT 1;

  IF v_other_live_assignment.id IS NOT NULL THEN
    RAISE EXCEPTION 'COURT_BUSY: Court % already has an active LIVE match (Assignment ID: %)',
      v_court.identifier, v_other_live_assignment.id
      USING ERRCODE = '23505';
  END IF;

  -- 6. Atomically Transition Assignment & Match
  UPDATE public.court_assignments
  SET 
    status = 'LIVE',
    started_at = timezone('utc'::text, now())
  WHERE id = p_court_assignment_id;

  UPDATE public.matches
  SET 
    status = 'IN_PROGRESS',
    updated_at = timezone('utc'::text, now())
  WHERE id = v_assignment.match_id;

  -- 7. Audit Log
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    tournament_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    'OFFICIAL',
    'START_COURT_MATCH',
    'COURT_ASSIGNMENT',
    p_court_assignment_id,
    v_court.tournament_id,
    jsonb_build_object(
      'match_id', v_assignment.match_id,
      'court_id', v_assignment.court_id,
      'court_identifier', v_court.identifier
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', p_court_assignment_id,
    'match_id', v_assignment.match_id,
    'court_id', v_assignment.court_id,
    'court_identifier', v_court.identifier,
    'status', 'LIVE'
  );
END;
$$;

-- 5. Update COMPLETE_COURT_MATCH with event official validation
CREATE OR REPLACE FUNCTION public.complete_court_match(
  p_match_id UUID,
  p_winner_registration_id UUID,
  p_decision_type public.decision_type DEFAULT 'POINTS'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_parent_match RECORD;
  v_existing_result_id UUID;
  v_result_id UUID;
BEGIN
  -- 1. Authentication & Role Validation
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock Source Match FOR UPDATE
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_match.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only IN_PROGRESS matches can be completed'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Check Authorization
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_match.tournament_id, v_match.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not have authority to finalize matches for this tournament'
      USING ERRCODE = '40300';
  END IF;

  IF p_winner_registration_id IS DISTINCT FROM v_match.red_corner_registration_id 
     AND p_winner_registration_id IS DISTINCT FROM v_match.blue_corner_registration_id THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Declared winner must be either RED or BLUE participant'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Upsert Official Match Result (Satisfies Validation Gate Trigger)
  SELECT id
  INTO v_existing_result_id
  FROM public.match_results
  WHERE match_id = p_match_id
  LIMIT 1;

  IF v_existing_result_id IS NOT NULL THEN
    UPDATE public.match_results
    SET 
      winner_registration_id = p_winner_registration_id,
      decision_type = p_decision_type,
      is_official = TRUE,
      finalized_by = v_requester_id,
      finalized_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_existing_result_id
    RETURNING id INTO v_result_id;
  ELSE
    INSERT INTO public.match_results (
      match_id,
      winner_registration_id,
      decision_type,
      is_official,
      finalized_by,
      finalized_at
    ) VALUES (
      p_match_id,
      p_winner_registration_id,
      p_decision_type,
      TRUE,
      v_requester_id,
      timezone('utc'::text, now())
    )
    RETURNING id INTO v_result_id;
  END IF;

  -- 5. Complete Match Record
  UPDATE public.matches
  SET 
    winner_registration_id = p_winner_registration_id,
    status = 'COMPLETED',
    updated_at = timezone('utc'::text, now())
  WHERE id = p_match_id;

  -- 6. Release Active Court Assignment to COMPLETED
  UPDATE public.court_assignments
  SET 
    status = 'COMPLETED',
    completed_at = timezone('utc'::text, now())
  WHERE match_id = p_match_id
  AND status = 'LIVE';

  -- 7. Atomic Graph Progression: Advance Winner to Next Match Node
  IF v_match.next_match_id IS NOT NULL THEN
    SELECT *
    INTO v_parent_match
    FROM public.matches
    WHERE id = v_match.next_match_id
    FOR UPDATE;

    IF v_parent_match.id IS NULL THEN
      RAISE EXCEPTION 'GRAPH_ERROR: Parent next_match_id % does not exist', v_match.next_match_id
        USING ERRCODE = '22000';
    END IF;

    IF v_parent_match.tournament_id IS DISTINCT FROM v_match.tournament_id 
       OR v_parent_match.event_id IS DISTINCT FROM v_match.event_id THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: Cross-tournament or cross-event graph edge detected'
        USING ERRCODE = '42501';
    END IF;

    IF v_match.next_match_corner = 'RED' THEN
      IF v_parent_match.red_corner_registration_id IS NOT NULL 
         AND v_parent_match.red_corner_registration_id <> p_winner_registration_id THEN
        RAISE EXCEPTION 'GRAPH_ERROR: Target parent RED corner is already occupied by a different participant'
          USING ERRCODE = '22000';
      END IF;

      UPDATE public.matches
      SET 
        red_corner_registration_id = p_winner_registration_id,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_match.next_match_id;

    ELSIF v_match.next_match_corner = 'BLUE' THEN
      IF v_parent_match.blue_corner_registration_id IS NOT NULL 
         AND v_parent_match.blue_corner_registration_id <> p_winner_registration_id THEN
        RAISE EXCEPTION 'GRAPH_ERROR: Target parent BLUE corner is already occupied by a different participant'
          USING ERRCODE = '22000';
      END IF;

      UPDATE public.matches
      SET 
        blue_corner_registration_id = p_winner_registration_id,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_match.next_match_id;
    END IF;
  END IF;

  -- 8. Audit Log
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    tournament_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    'OFFICIAL',
    'COMPLETE_COURT_MATCH',
    'MATCH',
    p_match_id,
    v_match.tournament_id,
    jsonb_build_object(
      'match_id', p_match_id,
      'winner_registration_id', p_winner_registration_id,
      'decision_type', p_decision_type,
      'result_id', v_result_id,
      'next_match_id', v_match.next_match_id,
      'next_match_corner', v_match.next_match_corner
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'match_id', p_match_id,
    'winner_registration_id', p_winner_registration_id,
    'decision_type', p_decision_type,
    'result_id', v_result_id,
    'next_match_id', v_match.next_match_id,
    'status', 'COMPLETED'
  );
END;
$$;

-- 6. Update CANCEL_MATCH_ASSIGNMENT with event official validation
CREATE OR REPLACE FUNCTION public.cancel_match_assignment(
  p_court_assignment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_assignment RECORD;
  v_match RECORD;
  v_court RECORD;
BEGIN
  -- 1. Authentication & Role Validation
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock Assignment
  SELECT *
  INTO v_assignment
  FROM public.court_assignments
  WHERE id = p_court_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court assignment does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_assignment.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot cancel a COMPLETED assignment'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock Match & Court
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = v_assignment.match_id
  FOR UPDATE;

  SELECT *
  INTO v_court
  FROM public.courts
  WHERE id = v_assignment.court_id
  FOR UPDATE;

  -- 4. Check Authorization
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_court.tournament_id, v_match.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not have authority to cancel assignments for this tournament'
      USING ERRCODE = '40300';
  END IF;

  -- 5. Rollback Match to SCHEDULED & clear court identifier
  UPDATE public.matches
  SET 
    status = 'SCHEDULED',
    court_identifier = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_assignment.match_id;

  -- 6. Delete or mark assignment
  DELETE FROM public.court_assignments
  WHERE id = p_court_assignment_id;

  -- 7. Audit Log
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    tournament_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    'OFFICIAL',
    'CANCEL_MATCH_ASSIGNMENT',
    'COURT_ASSIGNMENT',
    p_court_assignment_id,
    v_court.tournament_id,
    jsonb_build_object(
      'match_id', v_assignment.match_id,
      'court_id', v_assignment.court_id,
      'court_identifier', v_court.identifier,
      'reason', p_reason
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'court_assignment_id', p_court_assignment_id,
    'match_id', v_assignment.match_id,
    'status', 'CANCELLED'
  );
END;
$$;
