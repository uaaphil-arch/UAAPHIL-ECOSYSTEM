-- Migration: 20260830000075_finalize_anyo_checkin_lifecycle.sql
-- Description: Server-authoritative Anyo CHECKED_IN lifecycle state, audit metadata columns, and hardened call RPC.

-- ============================================================================
-- 1. SCHEMA EXTENSIONS (Enum & Audit Metadata Columns)
-- ============================================================================

-- Add CHECKED_IN status value to anyo_performance_status enum immediately after WAITING
ALTER TYPE public.anyo_performance_status ADD VALUE IF NOT EXISTS 'CHECKED_IN' AFTER 'WAITING';

-- Add physical check-in audit metadata columns (Audit metadata only, not lifecycle authority)
ALTER TABLE public.anyo_performances
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES public.profiles(id);

-- ============================================================================
-- 2. CANONICAL PHYSICAL CHECK-IN RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_anyo_performer_checked_in(
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
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Lock Performance Row
  SELECT * INTO v_perf 
  FROM public.anyo_performances 
  WHERE id = p_performance_id 
  FOR UPDATE;

  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock Session Row
  SELECT * INTO v_session 
  FROM public.anyo_category_sessions 
  WHERE id = v_perf.session_id 
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Finalized Session Guard
  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot check in performer in a finalized session' USING ERRCODE = '22000';
  END IF;

  -- 5. Authorization Check (Tournament Scoped Official)
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to check in court performers' USING ERRCODE = '40300';
  END IF;

  -- 6. State Transition Guard & Idempotency
  IF v_perf.status <> 'WAITING' THEN
    IF v_perf.status = 'CHECKED_IN' THEN
      RETURN jsonb_build_object(
        'success', TRUE,
        'performance_id', p_performance_id,
        'status', 'CHECKED_IN',
        'already_checked_in', TRUE
      );
    END IF;
    RAISE EXCEPTION 'INVALID_STATE: Performer #% is in status %, expected WAITING', v_perf.order_number, v_perf.status USING ERRCODE = '22000';
  END IF;

  -- 7. Execute Transition (WAITING -> CHECKED_IN)
  UPDATE public.anyo_performances
  SET 
    status = 'CHECKED_IN',
    checked_in_at = timezone('utc'::text, now()),
    checked_in_by = v_requester_id,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  -- 8. Audit Event Logging
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
    'ANYO_PERFORMER_CHECKED_IN',
    'ANYO_PERFORMANCE',
    p_performance_id,
    v_perf.tournament_id,
    jsonb_build_object(
      'previous_status', v_perf.status,
      'new_status', 'CHECKED_IN',
      'order_number', v_perf.order_number,
      'session_id', v_perf.session_id
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'status', 'CHECKED_IN',
    'checked_in_at', timezone('utc'::text, now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_anyo_performer_checked_in(UUID) TO authenticated;

-- ============================================================================
-- 3. HARDENED CALL ANYO PERFORMER RPC (FULL 00069 BASELINE PRESERVED)
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
  SELECT * INTO v_perf 
  FROM public.anyo_performances 
  WHERE id = p_performance_id 
  FOR UPDATE;

  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session 
  FROM public.anyo_category_sessions 
  WHERE id = v_perf.session_id 
  FOR UPDATE;

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

  -- 5. CRITICAL HARD CHECK-IN GATE: Must be CHECKED_IN
  IF v_perf.status <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'NOT_CHECKED_IN: Performer #% is in status %, but must be CHECKED_IN before calling', 
      v_perf.order_number, v_perf.status USING ERRCODE = '22000';
  END IF;

  -- 6. Session-Level Mutex Guard (Check if another performer in this session is already PERFORMING)
  SELECT EXISTS (
    SELECT 1 FROM public.anyo_performances
    WHERE session_id = v_perf.session_id
      AND status = 'PERFORMING'
      AND id <> p_performance_id
  ) INTO v_active_exists;

  IF v_active_exists THEN
    RAISE EXCEPTION 'ACTIVE_PERFORMER_EXISTS: Another performer is currently PERFORMING in this session' USING ERRCODE = '22000';
  END IF;

  -- 7. Deterministic Ascending Sequence Guard
  -- Verify no earlier competitor (lower order_number) remains unresolved (WAITING, CHECKED_IN, or CALLED)
  SELECT id, order_number INTO v_earlier_unresolved
  FROM public.anyo_performances
  WHERE session_id = v_perf.session_id
    AND order_number < v_perf.order_number
    AND status IN ('WAITING', 'CHECKED_IN', 'CALLED')
  ORDER BY order_number ASC
  LIMIT 1;

  IF v_earlier_unresolved.id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_SEQUENCE: Competitor #% cannot perform before earlier eligible competitors', 
      v_perf.order_number USING ERRCODE = '22000';
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
    'status', 'PERFORMING',
    'called_at', timezone('utc'::text, now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_anyo_performer(UUID) TO authenticated;
