-- ============================================================================
-- Migration: 20260830000070_forward_harden_anyo_retroactive_adjudication_and_fail_loud_configuration.sql
-- Description: P-ANYO-SCORE-03-C15 Atomic Forward Hardening:
--   1. Enforce explicit retroactive adjudication controls & terminal immutability in record_anyo_dq_or_noshow.
--   2. Enforce fail-loud configuration handling for panel_size and calc_method in record_anyo_score.
-- ============================================================================

-- ============================================================================
-- 1. HARDENING CONTROL H-01: record_anyo_dq_or_noshow with Retroactive Adjudication
-- ============================================================================
-- Drop prior overloads to ensure clean, unambiguous resolution
DROP FUNCTION IF EXISTS public.record_anyo_dq_or_noshow(UUID, TEXT);
DROP FUNCTION IF EXISTS public.record_anyo_dq_or_noshow(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_anyo_dq_or_noshow(
  p_performance_id UUID,
  p_outcome TEXT,
  p_reason TEXT DEFAULT NULL,
  p_is_retroactive BOOLEAN DEFAULT FALSE
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
  v_is_retro BOOLEAN;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Validate outcome parameter
  IF p_outcome = 'DQ' THEN
    v_new_status := 'DQ';
  ELSIF p_outcome = 'NO_SHOW' THEN
    v_new_status := 'NO_SHOW';
  ELSE
    RAISE EXCEPTION 'INVALID_ARGUMENT: Outcome must be DQ or NO_SHOW' USING ERRCODE = '22023';
  END IF;

  v_is_retro := COALESCE(p_is_retroactive, FALSE);

  -- 3. Fetch Performance & Session under row locks (Lock hierarchy: performance -> session)
  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Associated category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Session Finalization Immutability Gate (Finalized sessions cannot be modified under any flag)
  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category session is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 5. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized' USING ERRCODE = '40300';
  END IF;

  -- 6. State Machine & Terminal Immutability Validation
  IF v_perf.status = 'DQ' THEN
    RAISE EXCEPTION 'INVALID_STATE: Performer is already disqualified (DQ is an immutable terminal status)'
      USING ERRCODE = '22000';
  ELSIF v_perf.status = 'NO_SHOW' THEN
    RAISE EXCEPTION 'INVALID_STATE: Performer is already recorded as NO_SHOW (NO_SHOW is an immutable terminal status)'
      USING ERRCODE = '22000';
  ELSIF v_perf.status = 'COMPLETED' THEN
    IF NOT v_is_retro THEN
      RAISE EXCEPTION 'INVALID_STATE: Performer has already COMPLETED performance. Retroactive adjudication requires explicit p_is_retroactive=true'
        USING ERRCODE = '22000';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Retroactive adjudication requires a non-empty reason'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_perf.status IN ('WAITING', 'CALLED', 'PERFORMING') THEN
    -- Ordinary pre-completion / in-progress terminal disposition is permitted
    NULL;
  ELSE
    RAISE EXCEPTION 'INVALID_PERFORMANCE_STATE: Cannot transition from status % to %', v_perf.status, v_new_status
      USING ERRCODE = '22000';
  END IF;

  -- 7. Terminal status transition & score clearing
  UPDATE public.anyo_performances
  SET 
    status = v_new_status,
    final_score = NULL,
    completed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  -- 8. Phase 03 Pointer Synchronization: Clear current_performance_id only if it still points to this performer
  UPDATE public.anyo_category_sessions
  SET 
    current_performance_id = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_perf.session_id
    AND current_performance_id = p_performance_id;

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
    CASE WHEN v_perf.status = 'COMPLETED' AND v_is_retro THEN 'ANYO_RETROACTIVE_' || p_outcome ELSE 'ANYO_' || p_outcome END,
    'ANYO_PERFORMANCE',
    p_performance_id,
    v_perf.tournament_id,
    jsonb_build_object(
      'performance_id', p_performance_id,
      'session_id', v_perf.session_id,
      'previous_status', v_perf.status,
      'new_status', v_new_status,
      'outcome', p_outcome,
      'is_retroactive', v_is_retro,
      'reason', p_reason
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'session_id', v_perf.session_id,
    'previous_status', v_perf.status,
    'status', v_new_status,
    'is_retroactive', v_is_retro
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_anyo_dq_or_noshow(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_anyo_dq_or_noshow(UUID, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;


-- ============================================================================
-- 2. HARDENING CONTROL H-02: record_anyo_score with Fail-Loud Enum Configuration
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

  -- 5. Validate Panel Size with Fail-Loud Configuration Check
  IF v_session.panel_size = '5_JUDGES' THEN
    v_expected_len := 5;
  ELSIF v_session.panel_size = '7_JUDGES' THEN
    v_expected_len := 7;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_CONFIGURATION: Unsupported panel size %', v_session.panel_size
      USING ERRCODE = '22023';
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

  -- 7. Server-Side Authoritative Calculation with Fail-Loud Calc Method Check
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
  ELSIF v_session.calc_method = 'ARITHMETIC_MEAN' THEN
    -- Arithmetic Mean of all scores
    FOREACH v_score IN ARRAY p_judge_scores LOOP
      v_sum := v_sum + v_score;
      v_count := v_count + 1;
    END LOOP;
    v_trimmed_scores := p_judge_scores;
    v_calc_score := ROUND((v_sum / v_count::numeric), 2);
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_CONFIGURATION: Unsupported calculation method %', v_session.calc_method
      USING ERRCODE = '22023';
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
