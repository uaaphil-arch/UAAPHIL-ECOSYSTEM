-- Migration: 20260830000069_enforce_anyo_dual_staging_and_decimal_scoring.sql
-- Description: Enforce single active performing mutex per session, deterministic ascending call sequencing, terminal pointer synchronization, and server-authoritative decimal 7.0-10.0 (by 0.1) judge scoring
-- Target: Phase 03 (P-ANYO-SCORE-03-DUAL-STAGING-AND-DECIMAL-SCORING)

-- ============================================================================
-- 1. HARD DATABASE INVARIANT: At most one performer in 'PERFORMING' state per category session
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_anyo_single_active_performer
ON public.anyo_performances (session_id)
WHERE status = 'PERFORMING';

-- ============================================================================
-- 2. FORWARD SCHEMA CONVERSION: Support exact decimal representation for judge scores
-- ============================================================================
ALTER TABLE public.anyo_scores
  ALTER COLUMN judge_scores TYPE NUMERIC(3,1)[] USING judge_scores::NUMERIC(3,1)[];

ALTER TABLE public.anyo_scores
  ALTER COLUMN trimmed_scores TYPE NUMERIC(3,1)[] USING trimmed_scores::NUMERIC(3,1)[];

-- ============================================================================
-- 3. OVERLOAD RESOLUTION: Drop legacy INT[] signature to prevent overload bypass
-- ============================================================================
DROP FUNCTION IF EXISTS public.record_anyo_score(UUID, INT[], public.anyo_tie_tier);

-- ============================================================================
-- 4. RPC: call_anyo_performer (HARDENED MUTEX & ASCENDING SEQUENCE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.call_anyo_performer(
  p_performance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_perf RECORD;
  v_session RECORD;
  v_active_exists BOOLEAN;
  v_earlier_unresolved RECORD;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Performance & Session under row locks (Lock order: performance -> session)
  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Associated category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to call performers' USING ERRCODE = '40300';
  END IF;

  -- 4. Session Finalized Guard
  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category session is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 5. Valid Source States Check
  IF v_perf.status NOT IN ('WAITING', 'CALLED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Performer is already %', v_perf.status USING ERRCODE = '22000';
  END IF;

  -- 6. Session-Level Mutex Guard (Check if another performer in this session is already PERFORMING)
  SELECT EXISTS (
    SELECT 1 FROM public.anyo_performances
    WHERE session_id = v_perf.session_id
      AND status = 'PERFORMING'
      AND id <> p_performance_id
  ) INTO v_active_exists;

  IF v_active_exists THEN
    RAISE EXCEPTION 'ACTIVE_PERFORMER_EXISTS: Another performer is currently PERFORMING in this session'
      USING ERRCODE = '22000';
  END IF;

  -- 7. Deterministic Ascending Sequence Guard
  -- Verify no earlier competitor (lower order_number) remains unresolved (WAITING or CALLED)
  SELECT id, order_number INTO v_earlier_unresolved
  FROM public.anyo_performances
  WHERE session_id = v_perf.session_id
    AND order_number < v_perf.order_number
    AND status IN ('WAITING', 'CALLED')
  ORDER BY order_number ASC
  LIMIT 1;

  IF v_earlier_unresolved.id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_SEQUENCE: Competitor #% cannot perform before earlier eligible competitors',
      v_perf.order_number
      USING ERRCODE = '22000';
  END IF;

  -- 8. Atomic Activation: Transition performer and session
  UPDATE public.anyo_performances
  SET 
    status = 'PERFORMING',
    called_at = COALESCE(called_at, timezone('utc'::text, now())),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  UPDATE public.anyo_category_sessions
  SET 
    status = 'IN_PROGRESS',
    current_performance_id = p_performance_id,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_perf.session_id;

  -- 9. Audit Log
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
    'CALL_ANYO_PERFORMER',
    'ANYO_PERFORMANCE',
    p_performance_id,
    v_perf.tournament_id,
    jsonb_build_object(
      'performance_id', p_performance_id,
      'session_id', v_perf.session_id,
      'order_number', v_perf.order_number,
      'status', 'PERFORMING'
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'session_id', v_perf.session_id,
    'order_number', v_perf.order_number,
    'status', 'PERFORMING'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.call_anyo_performer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_anyo_performer(UUID) TO authenticated, service_role;


-- ============================================================================
-- 5. RPC: record_anyo_score (DECIMAL 7.0-10.0, 0.1 INCREMENTS & POINTER SYNC)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_anyo_score(
  p_performance_id UUID,
  p_judge_scores NUMERIC[],
  p_tier public.anyo_tie_tier DEFAULT 'TIER_1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_perf RECORD;
  v_session RECORD;
  v_score NUMERIC;
  v_expected_len INT;
  v_sorted_scores NUMERIC[];
  v_trimmed_scores NUMERIC[];
  v_calc_score NUMERIC(5,2);
  v_sum NUMERIC := 0.0;
  v_count INT := 0;
  v_score_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Performance & Session under row locks (Lock order: performance -> session)
  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Associated category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to submit Anyo scores' USING ERRCODE = '40300';
  END IF;

  -- 4. Server-Authoritative State Gate: Competitor must be actively PERFORMING under row lock
  IF v_perf.status <> 'PERFORMING' THEN
    RAISE EXCEPTION 'INVALID_PERFORMANCE_STATE: Performer is currently %; scoring is strictly permitted only when PERFORMING',
      v_perf.status
      USING ERRCODE = '22000';
  END IF;

  -- 5. Validate Panel Size
  IF v_session.panel_size = '5_JUDGES' THEN
    v_expected_len := 5;
  ELSIF v_session.panel_size = '7_JUDGES' THEN
    v_expected_len := 7;
  ELSE
    v_expected_len := 5;
  END IF;

  IF array_length(p_judge_scores, 1) IS DISTINCT FROM v_expected_len THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Expected % judge scores, received %',
      v_expected_len, COALESCE(array_length(p_judge_scores, 1), 0)
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate Decimal Range (Strictly 7.0 to 10.0) and Exact 0.1 Grid Increment
  FOREACH v_score IN ARRAY p_judge_scores LOOP
    IF v_score IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Judge score cannot be null'
        USING ERRCODE = '22023';
    END IF;

    IF v_score < 7.0 OR v_score > 10.0 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Judge score % is outside permitted 7.0-10.0 range', v_score
        USING ERRCODE = '22023';
    END IF;

    IF v_score <> round(v_score, 1) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Judge score % must use exactly 0.1 increments', v_score
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 7. Server-Side Authoritative Calculation with Exact NUMERIC Arithmetic
  IF v_session.calc_method = 'OLYMPIC_TRIM' THEN
    -- Sort scores in ascending order
    SELECT array_agg(s ORDER BY s ASC) INTO v_sorted_scores FROM unnest(p_judge_scores) s;
    -- Trim 1 lowest (index 1) and 1 highest (index v_expected_len)
    v_trimmed_scores := v_sorted_scores[2:v_expected_len - 1];

    FOREACH v_score IN ARRAY v_trimmed_scores LOOP
      v_sum := v_sum + v_score;
      v_count := v_count + 1;
    END LOOP;

    v_calc_score := ROUND((v_sum / v_count::numeric), 2);
  ELSE
    -- Arithmetic Mean of all scores
    FOREACH v_score IN ARRAY p_judge_scores LOOP
      v_sum := v_sum + v_score;
      v_count := v_count + 1;
    END LOOP;
    v_trimmed_scores := p_judge_scores;
    v_calc_score := ROUND((v_sum / v_count::numeric), 2);
  END IF;

  -- 8. Persist authoritative score atomically
  INSERT INTO public.anyo_scores (
    performance_id,
    session_id,
    tier,
    judge_scores,
    trimmed_scores,
    calculated_score,
    table_official_id,
    is_confirmed,
    updated_at
  ) VALUES (
    p_performance_id,
    v_perf.session_id,
    p_tier,
    p_judge_scores,
    v_trimmed_scores,
    v_calc_score,
    v_requester_id,
    TRUE,
    timezone('utc'::text, now())
  )
  ON CONFLICT (performance_id, tier)
  DO UPDATE SET
    judge_scores = EXCLUDED.judge_scores,
    trimmed_scores = EXCLUDED.trimmed_scores,
    calculated_score = EXCLUDED.calculated_score,
    table_official_id = EXCLUDED.table_official_id,
    is_confirmed = TRUE,
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_score_id;

  -- 9. Update Performance final_score and status to COMPLETED
  UPDATE public.anyo_performances
  SET 
    final_score = v_calc_score,
    status = 'COMPLETED',
    completed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  -- 10. Phase 03 Pointer Synchronization: Clear current_performance_id only if it still points to this completed performer
  UPDATE public.anyo_category_sessions
  SET 
    current_performance_id = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_perf.session_id
    AND current_performance_id = p_performance_id;

  -- 11. Audit Log
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
    'RECORD_ANYO_SCORE',
    'ANYO_SCORE',
    v_score_id,
    v_perf.tournament_id,
    jsonb_build_object(
      'performance_id', p_performance_id,
      'tier', p_tier,
      'judge_scores', p_judge_scores,
      'trimmed_scores', v_trimmed_scores,
      'calculated_score', v_calc_score,
      'calc_method', v_session.calc_method
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'score_id', v_score_id,
    'performance_id', p_performance_id,
    'tier', p_tier,
    'calculated_score', v_calc_score,
    'status', 'COMPLETED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_anyo_score(UUID, NUMERIC[], public.anyo_tie_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_anyo_score(UUID, NUMERIC[], public.anyo_tie_tier) TO authenticated, service_role;


-- ============================================================================
-- 6. RPC: record_anyo_dq_or_noshow (HARDENED POINTER SYNCHRONIZATION)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_anyo_dq_or_noshow(
  p_performance_id UUID,
  p_outcome TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_perf RECORD;
  v_session RECORD;
  v_new_status public.anyo_performance_status;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  IF p_outcome = 'DQ' THEN
    v_new_status := 'DQ';
  ELSIF p_outcome = 'NO_SHOW' THEN
    v_new_status := 'NO_SHOW';
  ELSE
    RAISE EXCEPTION 'INVALID_ARGUMENT: Outcome must be DQ or NO_SHOW' USING ERRCODE = '22023';
  END IF;

  -- 2. Fetch Performance & Session under row locks (Lock hierarchy: performance -> session)
  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Associated category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category session is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized' USING ERRCODE = '40300';
  END IF;

  -- 4. Terminal status transition
  UPDATE public.anyo_performances
  SET 
    status = v_new_status,
    final_score = NULL,
    completed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  -- 5. Phase 03 Pointer Synchronization: Clear current_performance_id only if it still points to this performer
  UPDATE public.anyo_category_sessions
  SET 
    current_performance_id = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_perf.session_id
    AND current_performance_id = p_performance_id;

  -- 6. Audit Log
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
    'ANYO_' || p_outcome,
    'ANYO_PERFORMANCE',
    p_performance_id,
    v_perf.tournament_id,
    jsonb_build_object(
      'performance_id', p_performance_id,
      'session_id', v_perf.session_id,
      'outcome', p_outcome,
      'reason', p_reason,
      'status', v_new_status
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'session_id', v_perf.session_id,
    'status', v_new_status
  );
END;
$$;

-- Drop obsolete 2-argument overload if exists
DROP FUNCTION IF EXISTS public.record_anyo_dq_or_noshow(UUID, TEXT);

REVOKE ALL ON FUNCTION public.record_anyo_dq_or_noshow(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_anyo_dq_or_noshow(UUID, TEXT, TEXT) TO authenticated, service_role;
