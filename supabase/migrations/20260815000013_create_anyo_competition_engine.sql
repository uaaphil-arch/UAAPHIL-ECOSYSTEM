-- Migration: 20260815000013_create_anyo_competition_engine.sql
-- Description: Additive Anyo Competition Engine for UAAPHIL Tournament System
-- Includes:
-- 1. Database Enums (anyo_panel_size, anyo_calc_method, anyo_performance_status, anyo_session_status, anyo_tie_tier)
-- 2. Tables: anyo_category_sessions, anyo_performances, anyo_scores, anyo_tier3_tallies
-- 3. RLS Policies (Read-only for public/authenticated, Mutation strictly through SECURITY DEFINER RPCs)
-- 4. Authoritative PostgreSQL RPCs:
--    - initialize_anyo_category_session
--    - reorder_anyo_performances
--    - call_anyo_performer
--    - record_anyo_score (Canonical name)
--    - record_anyo_dq_or_noshow
--    - record_anyo_tier3_majority
--    - finalize_anyo_category

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.anyo_panel_size AS ENUM ('5_JUDGES', '7_JUDGES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.anyo_calc_method AS ENUM ('OLYMPIC_TRIM', 'ARITHMETIC_MEAN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.anyo_performance_status AS ENUM (
    'WAITING',
    'CALLED',
    'PERFORMING',
    'SCORING',
    'COMPLETED',
    'DQ',
    'NO_SHOW'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.anyo_session_status AS ENUM (
    'SCHEDULED',
    'IN_PROGRESS',
    'TIE_TIER_2',
    'TIE_TIER_3',
    'FINALIZED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.anyo_tie_tier AS ENUM (
    'TIER_1',
    'TIER_2',
    'TIER_3_MAJORITY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- A. anyo_category_sessions
CREATE TABLE IF NOT EXISTS public.anyo_category_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  court_id UUID REFERENCES public.courts(id) ON DELETE SET NULL,
  panel_size public.anyo_panel_size NOT NULL DEFAULT '5_JUDGES',
  calc_method public.anyo_calc_method NOT NULL DEFAULT 'OLYMPIC_TRIM',
  status public.anyo_session_status NOT NULL DEFAULT 'SCHEDULED',
  current_performance_id UUID,
  finalized_by UUID REFERENCES public.profiles(id),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_anyo_category_session_event UNIQUE(tournament_id, event_id)
);

-- B. anyo_performances
CREATE TABLE IF NOT EXISTS public.anyo_performances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.anyo_category_sessions(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  order_number INT NOT NULL,
  status public.anyo_performance_status NOT NULL DEFAULT 'WAITING',
  final_score NUMERIC(5,2),
  final_rank INT,
  medal_awarded TEXT,
  called_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_anyo_performance_order UNIQUE(session_id, order_number),
  CONSTRAINT uq_anyo_performance_registration UNIQUE(session_id, registration_id)
);

-- Foreign key back to anyo_performances for active performer
DO $$ BEGIN
  ALTER TABLE public.anyo_category_sessions
    ADD CONSTRAINT fk_anyo_session_current_perf
    FOREIGN KEY (current_performance_id)
    REFERENCES public.anyo_performances(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- C. anyo_scores
CREATE TABLE IF NOT EXISTS public.anyo_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_id UUID NOT NULL REFERENCES public.anyo_performances(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.anyo_category_sessions(id) ON DELETE CASCADE,
  tier public.anyo_tie_tier NOT NULL DEFAULT 'TIER_1',
  judge_scores INT[] NOT NULL,
  trimmed_scores INT[],
  calculated_score NUMERIC(5,2) NOT NULL,
  table_official_id UUID NOT NULL REFERENCES public.profiles(id),
  is_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_anyo_score_perf_tier UNIQUE(performance_id, tier)
);

-- D. anyo_tier3_tallies (Immutable Majority Vote Audit Log)
CREATE TABLE IF NOT EXISTS public.anyo_tier3_tallies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.anyo_category_sessions(id) ON DELETE CASCADE,
  tied_performance_ids UUID[] NOT NULL,
  tallies JSONB NOT NULL,
  winning_performance_id UUID NOT NULL REFERENCES public.anyo_performances(id),
  panel_size INT NOT NULL,
  submitted_by UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL DEFAULT 'TIER_3_TIE_RESOLUTION',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.anyo_category_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anyo_performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anyo_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anyo_tier3_tallies ENABLE ROW LEVEL SECURITY;

-- Read policies (Open to authenticated and public for scoreboard viewing)
CREATE POLICY "anyo_sessions_read_all" ON public.anyo_category_sessions
  FOR SELECT USING (true);

CREATE POLICY "anyo_performances_read_all" ON public.anyo_performances
  FOR SELECT USING (true);

CREATE POLICY "anyo_scores_read_all" ON public.anyo_scores
  FOR SELECT USING (true);

CREATE POLICY "anyo_tier3_tallies_read_all" ON public.anyo_tier3_tallies
  FOR SELECT USING (true);

-- Direct mutations restricted; all authoritative mutations are performed via SECURITY DEFINER RPCs

-- ============================================================================
-- 4. AUTHORITATIVE POSTGRESQL RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC 1: initialize_anyo_category_session
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_anyo_category_session(
  p_tournament_id UUID,
  p_event_id UUID,
  p_court_id UUID DEFAULT NULL,
  p_panel_size public.anyo_panel_size DEFAULT '5_JUDGES',
  p_calc_method public.anyo_calc_method DEFAULT 'OLYMPIC_TRIM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_event RECORD;
  v_session RECORD;
  v_reg RECORD;
  v_order_counter INT := 1;
  v_session_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, p_tournament_id, p_event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized for this tournament' USING ERRCODE = '40300';
  END IF;

  -- 3. Fetch and validate event
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.tournament_id <> p_tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Event does not belong to tournament' USING ERRCODE = '42501';
  END IF;

  -- 4. Check or create session
  SELECT * INTO v_session FROM public.anyo_category_sessions
  WHERE tournament_id = p_tournament_id AND event_id = p_event_id;

  IF v_session.id IS NOT NULL THEN
    v_session_id := v_session.id;
  ELSE
    INSERT INTO public.anyo_category_sessions (
      tournament_id,
      event_id,
      court_id,
      panel_size,
      calc_method,
      status
    ) VALUES (
      p_tournament_id,
      p_event_id,
      p_court_id,
      p_panel_size,
      p_calc_method,
      'SCHEDULED'
    )
    RETURNING id INTO v_session_id;

    -- Fetch all approved registrations for this event
    FOR v_reg IN (
      SELECT r.id
      FROM public.registrations r
      WHERE r.event_id = p_event_id
      AND r.status = 'APPROVED'
      ORDER BY r.created_at ASC
    ) LOOP
      INSERT INTO public.anyo_performances (
        session_id,
        tournament_id,
        event_id,
        registration_id,
        order_number,
        status
      ) VALUES (
        v_session_id,
        p_tournament_id,
        p_event_id,
        v_reg.id,
        v_order_counter,
        'WAITING'
      );
      v_order_counter := v_order_counter + 1;
    END LOOP;
  END IF;

  -- 5. Audit Log
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
    'INITIALIZE_ANYO_SESSION',
    'ANYO_SESSION',
    v_session_id,
    p_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'court_id', p_court_id,
      'panel_size', p_panel_size,
      'calc_method', p_calc_method,
      'total_competitors', v_order_counter - 1
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', v_session_id,
    'status', 'SCHEDULED'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 2: reorder_anyo_performances
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_anyo_performances(
  p_session_id UUID,
  p_performance_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_perf_id UUID;
  v_order INT := 1;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized for this tournament session' USING ERRCODE = '40300';
  END IF;

  IF v_session.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Performance order cannot be modified once competition has started' USING ERRCODE = '22000';
  END IF;

  -- Temporary offset to avoid unique constraint collisions
  UPDATE public.anyo_performances
  SET order_number = order_number + 10000
  WHERE session_id = p_session_id;

  FOREACH v_perf_id IN ARRAY p_performance_ids LOOP
    UPDATE public.anyo_performances
    SET order_number = v_order, updated_at = timezone('utc'::text, now())
    WHERE id = v_perf_id AND session_id = p_session_id;
    v_order := v_order + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', p_session_id,
    'reordered_count', v_order - 1
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 3: call_anyo_performer
-- ----------------------------------------------------------------------------
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
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;

  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to call performers' USING ERRCODE = '40300';
  END IF;

  IF v_perf.status NOT IN ('WAITING', 'CALLED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Performer is already %', v_perf.status USING ERRCODE = '22000';
  END IF;

  -- Transition performer and session
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'session_id', v_perf.session_id,
    'status', 'PERFORMING'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 4: record_anyo_score (CANONICAL NAME)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_anyo_score(
  p_performance_id UUID,
  p_judge_scores INT[],
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
  v_score INT;
  v_expected_len INT;
  v_sorted_scores INT[];
  v_trimmed_scores INT[];
  v_calc_score NUMERIC(5,2);
  v_sum INT := 0;
  v_count INT := 0;
  v_i INT;
  v_score_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Performance & Session
  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = v_perf.session_id FOR UPDATE;
  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to submit Anyo scores' USING ERRCODE = '40300';
  END IF;

  -- 4. Validate Panel Size
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

  -- 5. Validate integer range (Strictly 6 to 10)
  FOREACH v_score IN ARRAY p_judge_scores LOOP
    IF v_score < 6 OR v_score > 10 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Judge score % is outside permitted 6-10 range', v_score
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 6. Server-Side Authoritative Calculation
  IF v_session.calc_method = 'OLYMPIC_TRIM' THEN
    -- Sort scores in ascending order
    SELECT array_agg(s ORDER BY s ASC) INTO v_sorted_scores FROM unnest(p_judge_scores) s;
    -- Trim 1 lowest (index 1) and 1 highest (index v_expected_len)
    v_trimmed_scores := v_sorted_scores[2:v_expected_len - 1];

    FOREACH v_score IN ARRAY v_trimmed_scores LOOP
      v_sum := v_sum + v_score;
      v_count := v_count + 1;
    END LOOP;

    v_calc_score := ROUND((v_sum::numeric / v_count::numeric), 2);
  ELSE
    -- Arithmetic Mean of all scores
    FOREACH v_score IN ARRAY p_judge_scores LOOP
      v_sum := v_sum + v_score;
      v_count := v_count + 1;
    END LOOP;
    v_trimmed_scores := p_judge_scores;
    v_calc_score := ROUND((v_sum::numeric / v_count::numeric), 2);
  END IF;

  -- 7. Persist authoritative score atomically
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

  -- 8. Update Performance final_score and status
  UPDATE public.anyo_performances
  SET 
    final_score = v_calc_score,
    status = 'COMPLETED',
    completed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

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

-- ----------------------------------------------------------------------------
-- RPC 5: record_anyo_dq_or_noshow
-- ----------------------------------------------------------------------------
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
  v_new_status public.anyo_performance_status;
BEGIN
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

  SELECT * INTO v_perf FROM public.anyo_performances WHERE id = p_performance_id FOR UPDATE;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Performance does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_authorized_tournament_official(v_requester_id, v_perf.tournament_id, v_perf.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized' USING ERRCODE = '40300';
  END IF;

  UPDATE public.anyo_performances
  SET 
    status = v_new_status,
    final_score = NULL,
    completed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_performance_id;

  -- Audit Log
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
      'outcome', p_outcome,
      'reason', p_reason
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'performance_id', p_performance_id,
    'status', v_new_status
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 6: record_anyo_tier3_majority
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_anyo_tier3_majority(
  p_session_id UUID,
  p_tied_performance_ids UUID[],
  p_tallies JSONB,
  p_winning_performance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_expected_panel_size INT;
  v_total_votes INT := 0;
  v_key TEXT;
  v_val INT;
  v_tally_id UUID;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized' USING ERRCODE = '40300';
  END IF;

  v_expected_panel_size := CASE WHEN v_session.panel_size = '7_JUDGES' THEN 7 ELSE 5 END;

  -- Validate total votes match panel size
  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_tallies) LOOP
    v_total_votes := v_total_votes + v_val;
  END LOOP;

  IF v_total_votes <> v_expected_panel_size THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Total majority votes (%) must equal panel size (%)',
      v_total_votes, v_expected_panel_size USING ERRCODE = '22023';
  END IF;

  -- Insert immutable audit record
  INSERT INTO public.anyo_tier3_tallies (
    session_id,
    tied_performance_ids,
    tallies,
    winning_performance_id,
    panel_size,
    submitted_by,
    reason,
    created_at
  ) VALUES (
    p_session_id,
    p_tied_performance_ids,
    p_tallies,
    p_winning_performance_id,
    v_expected_panel_size,
    v_requester_id,
    'TIER_3_TIE_RESOLUTION',
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_tally_id;

  -- Audit Log
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
    'TIER_3_MAJORITY_RESOLVED',
    'ANYO_TIER3_TALLY',
    v_tally_id,
    v_session.tournament_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'tallies', p_tallies,
      'winner', p_winning_performance_id
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tally_id', v_tally_id,
    'winning_performance_id', p_winning_performance_id
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 7: finalize_anyo_category
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_anyo_category(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_incomplete_count INT;
  v_rank_cursor RECORD;
  v_current_rank INT := 1;
  v_medal TEXT;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Only ORGANIZER, ADMIN, or SUPER_ADMIN may finalize an Anyo category
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = v_requester_id
    AND p.status = 'ACTIVE'
    AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Organizer or Admin can finalize an Anyo category' USING ERRCODE = '40300';
  END IF;

  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Category session is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 2. Pre-close validation: verify all performances are finished
  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
  AND status NOT IN ('COMPLETED', 'DQ', 'NO_SHOW');

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'PRE_CLOSE_VALIDATION_FAILED: % competitors have not completed scoring', v_incomplete_count
      USING ERRCODE = '22000';
  END IF;

  -- 3. Calculate and award deterministic ranking
  FOR v_rank_cursor IN (
    SELECT id, final_score, status
    FROM public.anyo_performances
    WHERE session_id = p_session_id
    ORDER BY 
      CASE WHEN status = 'COMPLETED' THEN 1 ELSE 2 END,
      final_score DESC NULLS LAST,
      order_number ASC
  ) LOOP
    IF v_rank_cursor.status = 'COMPLETED' THEN
      v_medal := CASE 
        WHEN v_current_rank = 1 THEN 'GOLD'
        WHEN v_current_rank = 2 THEN 'SILVER'
        WHEN v_current_rank = 3 THEN 'BRONZE'
        ELSE NULL
      END;

      UPDATE public.anyo_performances
      SET 
        final_rank = v_current_rank,
        medal_awarded = v_medal,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_rank_cursor.id;

      v_current_rank := v_current_rank + 1;
    ELSE
      UPDATE public.anyo_performances
      SET 
        final_rank = NULL,
        medal_awarded = NULL,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_rank_cursor.id;
    END IF;
  END LOOP;

  -- 4. Mark session FINALIZED
  UPDATE public.anyo_category_sessions
  SET 
    status = 'FINALIZED',
    finalized_by = v_requester_id,
    finalized_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  -- 5. Audit Log
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
    'ORGANIZER',
    'FINALIZE_ANYO_CATEGORY',
    'ANYO_SESSION',
    p_session_id,
    v_session.tournament_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'ranked_count', v_current_rank - 1
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', p_session_id,
    'status', 'FINALIZED',
    'ranked_count', v_current_rank - 1
  );
END;
$$;
