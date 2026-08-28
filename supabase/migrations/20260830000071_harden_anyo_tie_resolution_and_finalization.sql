-- Migration: 20260830000071_harden_anyo_tie_resolution_and_finalization.sql
-- Description: P-ANYO-TALLY-06 — Strict Atomic Hardening: Anyo Tier 3 Majority + Cluster-Scoped Final Ranking
-- Enforces true mathematical majority, strict tally key bijection, and cluster-scoped pairwise tie resolution.

-- ============================================================================
-- 1. HARDENED RPC: record_anyo_tier3_majority
-- ============================================================================
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
  v_min_majority INT;
  v_total_votes INT := 0;
  v_winner_votes INT := 0;
  v_perf_id UUID;
  v_key TEXT;
  v_key_uuid UUID;
  v_val_raw JSONB;
  v_val INT;
  v_tally_id UUID;
  v_tied_count INT;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Row lock on session (Hierarchy: session FOR UPDATE)
  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot record Tier 3 majority tally on a FINALIZED session' USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to submit Tier 3 tallies' USING ERRCODE = '40300';
  END IF;

  -- 4. Validate tied performances array
  IF p_tied_performance_ids IS NULL OR array_length(p_tied_performance_ids, 1) < 2 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: At least 2 tied performances are required for Tier 3 majority vote'
      USING ERRCODE = '22023';
  END IF;

  v_tied_count := array_length(p_tied_performance_ids, 1);

  -- Check for duplicate UUIDs in p_tied_performance_ids
  IF (SELECT count(DISTINCT u) FROM unnest(p_tied_performance_ids) AS u) <> v_tied_count THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Duplicate performance IDs in tied performances array'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_winning_performance_id = ANY(p_tied_performance_ids)) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Winning performance % must be included in tied performances array',
      p_winning_performance_id
      USING ERRCODE = '22023';
  END IF;

  -- Verify all tied performances belong to this session and have status COMPLETED
  FOREACH v_perf_id IN ARRAY p_tied_performance_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.anyo_performances
      WHERE id = v_perf_id AND session_id = p_session_id AND status = 'COMPLETED'
    ) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Performance % does not belong to session % or is not COMPLETED',
        v_perf_id, p_session_id
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 5. Validate tallies object schema and strict bijection
  IF p_tallies IS NULL OR jsonb_typeof(p_tallies) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Tallies must be a non-null JSON object' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(p_tallies)) <> v_tied_count THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Number of tally keys (%) must exactly equal the number of tied performances (%)',
      (SELECT count(*) FROM jsonb_object_keys(p_tallies)), v_tied_count
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_perf_id IN ARRAY p_tied_performance_ids LOOP
    IF NOT (p_tallies ? v_perf_id::text) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Missing tally entry for tied performance %', v_perf_id
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 6. Validate values, cast type safety, and no unknown keys
  FOR v_key, v_val_raw IN SELECT * FROM jsonb_each(p_tallies) LOOP
    BEGIN
      v_key_uuid := v_key::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Tally key "%" is not a valid UUID', v_key USING ERRCODE = '22023';
    END;

    IF NOT (v_key_uuid = ANY(p_tied_performance_ids)) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Unknown performance ID "%" in tallies object', v_key USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_val_raw) <> 'number' OR (v_val_raw#>>'{}')::numeric <> trunc((v_val_raw#>>'{}')::numeric) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Vote count for performance % must be an integer', v_key USING ERRCODE = '22023';
    END IF;

    v_val := (v_val_raw#>>'{}')::int;
    IF v_val < 0 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Vote count for performance % cannot be negative', v_key USING ERRCODE = '22023';
    END IF;

    v_total_votes := v_total_votes + v_val;
    IF v_key = p_winning_performance_id::text THEN
      v_winner_votes := v_val;
    END IF;
  END LOOP;

  -- 7. Validate total votes match session panel size
  v_expected_panel_size := CASE WHEN v_session.panel_size = '7_JUDGES' THEN 7 ELSE 5 END;

  IF v_total_votes <> v_expected_panel_size THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Total majority votes (%) must equal session panel size (%)',
      v_total_votes, v_expected_panel_size
      USING ERRCODE = '22023';
  END IF;

  -- 8. Strict True Majority Requirement:
  -- Winner must obtain > floor(panel_size / 2) (i.e. >= 3 for 5 judges, >= 4 for 7 judges)
  v_min_majority := (v_expected_panel_size / 2) + 1;
  IF v_winner_votes < v_min_majority THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Winning performance % received % votes, failing to obtain a strict majority of at least % votes for a %-judge panel',
      p_winning_performance_id, v_winner_votes, v_min_majority, v_expected_panel_size
      USING ERRCODE = '22023';
  END IF;

  -- Winner must have strictly higher votes than every other tied contender
  FOR v_key, v_val_raw IN SELECT * FROM jsonb_each(p_tallies) LOOP
    v_val := (v_val_raw#>>'{}')::int;
    IF v_key <> p_winning_performance_id::text AND v_val >= v_winner_votes THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Winning performance must have strictly more votes than other contenders'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 9. Insert immutable Tier 3 tally audit record
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

  -- 10. Audit Log
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
      'winning_performance_id', p_winning_performance_id,
      'panel_size', v_expected_panel_size,
      'winner_votes', v_winner_votes
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

REVOKE ALL ON FUNCTION public.record_anyo_tier3_majority(UUID, UUID[], JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_anyo_tier3_majority(UUID, UUID[], JSONB, UUID) TO authenticated, service_role;


-- ============================================================================
-- 2. HARDENED RPC: finalize_anyo_category (CLUSTER-SCOPED PAIRWISE RESOLUTION)
-- ============================================================================
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
  v_completed_count INT;
  v_score_group RECORD;
  v_member_count INT;
  v_start_rank INT := 1;
  v_current_rank INT := 1;
  v_medal TEXT;
  v_rank_cursor RECORD;
  v_unresolved_pair RECORD;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Row Lock on Session (Hierarchy: session FOR UPDATE)
  SELECT * INTO v_session FROM public.anyo_category_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo category session does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Anyo category session is already FINALIZED' USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization check (SUPER_ADMIN, ADMIN, or ORGANIZER)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = v_requester_id
    AND p.status = 'ACTIVE'
    AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Organizer or Admin can finalize an Anyo category' USING ERRCODE = '40300';
  END IF;

  -- 4. Pre-close validation: verify all performances are finished (terminal state: COMPLETED, DQ, NO_SHOW)
  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
  AND status NOT IN ('COMPLETED', 'DQ', 'NO_SHOW');

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'PRE_CLOSE_VALIDATION_FAILED: % competitors have not completed scoring', v_incomplete_count
      USING ERRCODE = '22000';
  END IF;

  -- 5. Clear rank/medals for non-completed performers (DQ / NO_SHOW)
  UPDATE public.anyo_performances
  SET 
    final_rank = NULL,
    medal_awarded = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE session_id = p_session_id
    AND status IN ('DQ', 'NO_SHOW');

  -- Count completed performers
  SELECT COUNT(*) INTO v_completed_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
    AND status = 'COMPLETED';

  IF v_completed_count = 0 THEN
    -- All DQ or NO_SHOW, finalize gracefully with 0 ranked
    UPDATE public.anyo_category_sessions
    SET 
      status = 'FINALIZED',
      finalized_by = v_requester_id,
      finalized_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'session_id', p_session_id,
      'status', 'FINALIZED',
      'ranked_count', 0
    );
  END IF;

  -- 6. Medal-Contention Tie Validation Gate
  CREATE TEMP TABLE temp_anyo_performances (
    performance_id UUID PRIMARY KEY,
    t1_score NUMERIC(5,2) NOT NULL,
    t2_score NUMERIC(5,2),
    order_number INT NOT NULL,
    head_to_head_wins INT DEFAULT 0
  ) ON COMMIT DROP;

  -- Populate temp table with performance data and Tier 2 scores
  INSERT INTO temp_anyo_performances (
    performance_id,
    t1_score,
    t2_score,
    order_number
  )
  SELECT 
    ap.id,
    ap.final_score,
    t2.calculated_score AS t2_score,
    ap.order_number
  FROM public.anyo_performances ap
  LEFT JOIN public.anyo_scores t2 
    ON t2.performance_id = ap.id AND t2.tier = 'TIER_2' AND t2.is_confirmed = TRUE
  WHERE ap.session_id = p_session_id
    AND ap.status = 'COMPLETED';

  -- Inspect distinct score groups descending
  v_start_rank := 1;
  FOR v_score_group IN (
    SELECT t1_score, COUNT(*) as group_size, array_agg(performance_id) as member_ids
    FROM temp_anyo_performances
    GROUP BY t1_score
    ORDER BY t1_score DESC
  ) LOOP
    v_member_count := v_score_group.group_size;

    -- Check if this score group intersects with medal positions (Rank 1, 2, 3 or Bronze boundary)
    IF v_start_rank <= 3 AND v_member_count > 1 THEN
      -- Group has a tie affecting medal allocation.
      -- Assert that every pair in the tied group has an authoritative Tier 2 or Tier 3 resolution.
      FOR v_unresolved_pair IN (
        SELECT a.performance_id AS perf_a, b.performance_id AS perf_b
        FROM temp_anyo_performances a
        JOIN temp_anyo_performances b ON a.performance_id < b.performance_id
        WHERE a.performance_id = ANY(v_score_group.member_ids)
          AND b.performance_id = ANY(v_score_group.member_ids)
          AND NOT (
            -- Tier 2 separation: both completed T2 and scores are distinct
            (a.t2_score IS NOT NULL AND b.t2_score IS NOT NULL AND a.t2_score <> b.t2_score)
            OR
            -- Tier 3 separation: an official Tier 3 tally exists for this session covering both with a winner in {a, b}
            EXISTS (
              SELECT 1 FROM public.anyo_tier3_tallies
              WHERE session_id = p_session_id
                AND tied_performance_ids @> ARRAY[a.performance_id, b.performance_id]
                AND winning_performance_id IN (a.performance_id, b.performance_id)
            )
          )
      ) LOOP
        -- Fail loud: Medal-relevant tie cannot be resolved by order_number!
        RAISE EXCEPTION 'UNRESOLVED_MEDAL_TIE: Unresolved tie among performances with score % in session % affecting medal position (Rank %-%). Tier 2 re-performance or Tier 3 majority decision required.',
          v_score_group.t1_score, p_session_id, v_start_rank, (v_start_rank + v_member_count - 1)
          USING ERRCODE = '22000';
      END LOOP;
    END IF;

    v_start_rank := v_start_rank + v_member_count;
  END LOOP;

  -- 7. Compute Cluster-Scoped Head-to-Head Wins for each competitor
  -- Competitor 'a' wins head-to-head against peer 'b' in the same T1 cluster if:
  -- (1) Both have Tier 2 and a.t2_score > b.t2_score, OR
  -- (2) Tier 2 is equal or absent, and a Tier 3 tally exists covering {a, b} where 'a' was declared the winner.
  UPDATE temp_anyo_performances a
  SET head_to_head_wins = (
    SELECT COUNT(*)
    FROM temp_anyo_performances b
    WHERE b.t1_score = a.t1_score
      AND b.performance_id <> a.performance_id
      AND (
        (a.t2_score IS NOT NULL AND b.t2_score IS NOT NULL AND a.t2_score > b.t2_score)
        OR
        (
          (a.t2_score IS NULL OR b.t2_score IS NULL OR a.t2_score = b.t2_score)
          AND EXISTS (
            SELECT 1 FROM public.anyo_tier3_tallies
            WHERE session_id = p_session_id
              AND tied_performance_ids @> ARRAY[a.performance_id, b.performance_id]
              AND winning_performance_id = a.performance_id
          )
        )
      )
  );

  -- 8. Apply deterministic ranking and medals:
  -- Tier 1 score DESC -> Cluster H2H Wins DESC -> Tier 2 score DESC -> order_number ASC (non-medal only)
  v_current_rank := 1;
  FOR v_rank_cursor IN (
    SELECT 
      performance_id,
      t1_score,
      head_to_head_wins,
      t2_score,
      order_number
    FROM temp_anyo_performances
    ORDER BY 
      t1_score DESC,
      head_to_head_wins DESC,
      t2_score DESC NULLS LAST,
      order_number ASC
  ) LOOP
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
    WHERE id = v_rank_cursor.performance_id;

    v_current_rank := v_current_rank + 1;
  END LOOP;

  -- 9. Mark session FINALIZED atomically
  UPDATE public.anyo_category_sessions
  SET 
    status = 'FINALIZED',
    finalized_by = v_requester_id,
    finalized_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  -- 10. Audit Log
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
      'ranked_count', v_current_rank - 1,
      'status', 'FINALIZED'
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

REVOKE ALL ON FUNCTION public.finalize_anyo_category(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_anyo_category(UUID) TO authenticated, service_role;
