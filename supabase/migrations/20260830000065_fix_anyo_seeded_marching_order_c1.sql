-- Migration: 20260830000065_fix_anyo_seeded_marching_order_c1.sql
-- Description: Corrective Patch P-ANYO-02-C1 for ANYO Achievement-Based Seeded Marching Order Engine
-- Target Domain: UAAPHIL Tournament System (Forms / ANYO Engine)
-- Sequence: 000065 (Strictly Limited 7 Fixes, Preserves Full Contact Engine & Historical Data)

-- ============================================================================
-- FIX 6 OF 7: HARDEN HISTORICAL SEEDING AGAINST UNSEALED/INVALID TOURNAMENTS
-- ============================================================================
-- Update get_athlete_anyo_seed_tier to require:
-- 1. Exact canonical category equality (events.category = p_category)
-- 2. Same athlete identity (registrations.user_id = p_user_id)
-- 3. Completed performance (ap.status = 'COMPLETED')
-- 4. Finalized ANYO session (acs.status = 'FINALIZED')
-- 5. Sealed/Completed tournament with valid tournament_closure_seals record
-- 6. Recency within [p_cutoff - 24 months, p_cutoff]

CREATE OR REPLACE FUNCTION public.get_athlete_anyo_seed_tier(
  p_user_id UUID,
  p_category TEXT,
  p_cutoff TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_highest_tier INT := 5;
  v_classification TEXT := 'UNSEEDED';
  v_draw_group TEXT := 'UNSEEDED';
  v_qualifying_list JSONB := '[]'::jsonb;
  v_qualifying_count INT := 0;
  v_window_start TIMESTAMPTZ;
BEGIN
  -- Window start: 24 months before snapshot/seeding cutoff
  v_window_start := p_cutoff - INTERVAL '24 months';

  -- Team ANYO Boundary: If this is a Team category, roster changes cannot be reliably tracked to individual history
  IF p_category ILIKE 'Team%' THEN
    RETURN jsonb_build_object(
      'seed_tier', 5,
      'historical_classification', 'UNSEEDED',
      'draw_group', 'UNSEEDED',
      'seed_details', jsonb_build_object(
        'category', p_category,
        'is_team_category', TRUE,
        'note', 'Team ANYO categories use unseeded randomized marching group',
        'qualifying_count', 0
      )
    );
  END IF;

  -- Individual ANYO Historical Query
  -- STRICT INVARIANTS:
  -- 1. Exact canonical category match (events.category = p_category)
  -- 2. Performance status = 'COMPLETED'
  -- 3. Session status = 'FINALIZED'
  -- 4. Tournament status = 'COMPLETED' and validated closure seal exists
  -- 5. Timestamp within [v_window_start, p_cutoff]
  FOR v_rec IN (
    SELECT 
      ap.id AS performance_id,
      ap.medal_awarded,
      ap.final_rank,
      ap.final_score,
      COALESCE(ap.completed_at, acs.finalized_at, ap.created_at) AS achievement_date,
      t.id AS tournament_id,
      t.name AS tournament_name
    FROM public.anyo_performances ap
    JOIN public.anyo_category_sessions acs ON acs.id = ap.session_id
    JOIN public.events e ON e.id = ap.event_id
    JOIN public.registrations r ON r.id = ap.registration_id
    JOIN public.tournaments t ON t.id = ap.tournament_id
    JOIN public.tournament_closure_seals tcs ON tcs.tournament_id = t.id
    WHERE r.user_id = p_user_id
      AND e.category = p_category
      AND ap.status = 'COMPLETED'
      AND acs.status = 'FINALIZED'
      AND t.status = 'COMPLETED'
      AND COALESCE(ap.completed_at, acs.finalized_at, ap.created_at) >= v_window_start
      AND COALESCE(ap.completed_at, acs.finalized_at, ap.created_at) <= p_cutoff
    ORDER BY 
      CASE 
        WHEN ap.medal_awarded = 'GOLD' THEN 1
        WHEN ap.medal_awarded = 'SILVER' THEN 2
        WHEN ap.medal_awarded = 'BRONZE' THEN 3
        ELSE 4
      END ASC,
      COALESCE(ap.completed_at, ap.created_at) DESC
  ) LOOP
    v_qualifying_count := v_qualifying_count + 1;
    v_qualifying_list := v_qualifying_list || jsonb_build_object(
      'tournament_id', v_rec.tournament_id,
      'tournament_name', v_rec.tournament_name,
      'medal_awarded', v_rec.medal_awarded,
      'final_rank', v_rec.final_rank,
      'final_score', v_rec.final_score,
      'achievement_date', v_rec.achievement_date
    );

    -- Classify highest qualifying tier
    IF v_rec.medal_awarded = 'GOLD' AND v_highest_tier > 1 THEN
      v_highest_tier := 1;
      v_classification := 'TOP_SEEDED_GOLD';
      v_draw_group := 'GOLD';
    ELSIF v_rec.medal_awarded = 'SILVER' AND v_highest_tier > 2 THEN
      v_highest_tier := 2;
      v_classification := 'HIGH_SEEDED_SILVER';
      v_draw_group := 'SILVER';
    ELSIF v_rec.medal_awarded = 'BRONZE' AND v_highest_tier > 3 THEN
      v_highest_tier := 3;
      v_classification := 'SEEDED_BRONZE';
      v_draw_group := 'BRONZE';
    ELSIF v_highest_tier > 4 THEN
      v_highest_tier := 4;
      v_classification := 'EXPERIENCED';
      v_draw_group := 'EXPERIENCED';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'seed_tier', v_highest_tier,
    'historical_classification', v_classification,
    'draw_group', v_draw_group,
    'seed_details', jsonb_build_object(
      'category', p_category,
      'qualifying_count', v_qualifying_count,
      'highest_medal', CASE 
        WHEN v_highest_tier = 1 THEN 'GOLD'
        WHEN v_highest_tier = 2 THEN 'SILVER'
        WHEN v_highest_tier = 3 THEN 'BRONZE'
        ELSE NULL
      END,
      'seeding_cutoff', p_cutoff,
      'recency_window_months', 24,
      'qualifying_history', v_qualifying_list
    )
  );
END;
$$;

-- ============================================================================
-- FIX 1 & FIX 5: ENFORCE TRUE IMMUTABILITY ON CONFIRMED DRAWS & ACCURATE RANDOMIZATION
-- ============================================================================
-- In generate_anyo_marching_order:
-- 1. If draw_status = 'CONFIRMED', reject ALL calls (no regeneration bypass)
-- 2. Regeneration allowed only while session = 'SCHEDULED', draw_status <> 'CONFIRMED', and all performers = 'WAITING'
-- 3. Accurate non-cryptographic terminology (server-authoritative randomized ordering within tier)

CREATE OR REPLACE FUNCTION public.generate_anyo_marching_order(
  p_session_id UUID,
  p_is_regeneration BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_event RECORD;
  v_seeding_cutoff TIMESTAMPTZ;
  v_total_performers INT := 0;
  v_active_performers_count INT := 0;
  v_perf RECORD;
  v_seed_res JSONB;
  v_order_counter INT := 1;
  v_new_version INT;
  v_tier_counts JSONB := jsonb_build_object(
    'tier_1_gold', 0,
    'tier_2_silver', 0,
    'tier_3_bronze', 0,
    'tier_4_experienced', 0,
    'tier_5_unseeded', 0
  );
  v_draw_results JSONB := '[]'::jsonb;
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to generate marching order'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock session row for update
  SELECT * INTO v_session
  FROM public.anyo_category_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session with ID % does not exist', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authorization Check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to configure this tournament session'
      USING ERRCODE = '40300';
  END IF;

  -- 4. FIX 1 OF 7: Enforce True Immutability Once Draw is CONFIRMED
  -- Rejects unconditionally regardless of p_is_regeneration or caller role
  IF v_session.draw_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Official marching order has been CONFIRMED and is strictly immutable. Generation and regeneration are prohibited.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Session State Validation
  IF v_session.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Marching order cannot be generated when session status is %. Only SCHEDULED sessions can be drawn.', v_session.status
      USING ERRCODE = '22000';
  END IF;

  -- 6. Performer Status Validation (No generation/regeneration once any performance is active)
  SELECT COUNT(*) INTO v_active_performers_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
    AND status <> 'WAITING'::public.anyo_performance_status;

  IF v_active_performers_count > 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: Marching order cannot be generated because % performer(s) have already been called, scored, or completed.', v_active_performers_count
      USING ERRCODE = '22000';
  END IF;

  -- 7. Snapshot & Seeding Cutoff Anchor Resolution
  SELECT e.*, ts.created_at AS snapshot_created_at
  INTO v_event
  FROM public.events e
  LEFT JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE e.id = v_session.event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event configuration for session % does not exist', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Authoritative cutoff: snapshot creation time (or fallback to session creation time)
  v_seeding_cutoff := COALESCE(v_event.snapshot_created_at, v_session.created_at);

  -- 8. Temporary Table for Staging and Server-Authoritative Randomized Placement
  CREATE TEMP TABLE temp_anyo_draw_pool (
    perf_id UUID PRIMARY KEY,
    user_id UUID,
    seed_tier INT,
    historical_classification TEXT,
    draw_group TEXT,
    seed_details JSONB,
    random_weight FLOAT,
    created_at TIMESTAMPTZ
  ) ON COMMIT DROP;

  -- 9. Evaluate each registered competitor against authoritative historical records
  FOR v_perf IN (
    SELECT 
      ap.id AS perf_id,
      r.user_id,
      ap.created_at
    FROM public.anyo_performances ap
    JOIN public.registrations r ON r.id = ap.registration_id
    WHERE ap.session_id = p_session_id
  ) LOOP
    v_total_performers := v_total_performers + 1;

    -- Calculate historical seed tier
    v_seed_res := public.get_athlete_anyo_seed_tier(
      v_perf.user_id,
      v_event.category,
      v_seeding_cutoff
    );

    -- Insert into staging pool with server-authoritative randomized float weight
    INSERT INTO temp_anyo_draw_pool (
      perf_id,
      user_id,
      seed_tier,
      historical_classification,
      draw_group,
      seed_details,
      random_weight,
      created_at
    ) VALUES (
      v_perf.perf_id,
      v_perf.user_id,
      (v_seed_res->>'seed_tier')::INT,
      v_seed_res->>'historical_classification',
      v_seed_res->>'draw_group',
      v_seed_res->'seed_details',
      random(),
      v_perf.created_at
    );

    -- Update tier distribution counters
    IF (v_seed_res->>'seed_tier')::INT = 1 THEN
      v_tier_counts := jsonb_set(v_tier_counts, '{tier_1_gold}', ((v_tier_counts->>'tier_1_gold')::INT + 1)::text::jsonb);
    ELSIF (v_seed_res->>'seed_tier')::INT = 2 THEN
      v_tier_counts := jsonb_set(v_tier_counts, '{tier_2_silver}', ((v_tier_counts->>'tier_2_silver')::INT + 1)::text::jsonb);
    ELSIF (v_seed_res->>'seed_tier')::INT = 3 THEN
      v_tier_counts := jsonb_set(v_tier_counts, '{tier_3_bronze}', ((v_tier_counts->>'tier_3_bronze')::INT + 1)::text::jsonb);
    ELSIF (v_seed_res->>'seed_tier')::INT = 4 THEN
      v_tier_counts := jsonb_set(v_tier_counts, '{tier_4_experienced}', ((v_tier_counts->>'tier_4_experienced')::INT + 1)::text::jsonb);
    ELSE
      v_tier_counts := jsonb_set(v_tier_counts, '{tier_5_unseeded}', ((v_tier_counts->>'tier_5_unseeded')::INT + 1)::text::jsonb);
    END IF;
  END LOOP;

  IF v_total_performers = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: No performers exist in session % to generate marching order', p_session_id
      USING ERRCODE = '22000';
  END IF;

  -- 10. Temporary offset to avoid unique constraint collisions on (session_id, order_number)
  UPDATE public.anyo_performances
  SET order_number = order_number + 50000
  WHERE session_id = p_session_id;

  -- 11. Assign Order by Performance Groups:
  -- Order: Tier 5 (Unseeded) -> Tier 4 (Experienced) -> Tier 3 (Bronze) -> Tier 2 (Silver) -> Tier 1 (Gold/Top)
  -- Within each tier: Server-authoritative randomized ordering (random_weight ASC)
  FOR v_perf IN (
    SELECT 
      t.perf_id,
      t.seed_tier,
      t.historical_classification,
      t.draw_group,
      t.seed_details
    FROM temp_anyo_draw_pool t
    ORDER BY 
      t.seed_tier DESC,       -- 5 (Unseeded) first, 1 (Gold) last
      t.random_weight ASC,    -- Randomized within tier group
      t.created_at ASC,       -- Deterministic fallback
      t.perf_id ASC
  ) LOOP
    UPDATE public.anyo_performances
    SET 
      order_number = v_order_counter,
      seed_tier = v_perf.seed_tier,
      historical_classification = v_perf.historical_classification,
      draw_group = v_perf.draw_group,
      seed_details = v_perf.seed_details,
      seeding_cutoff_at = v_seeding_cutoff,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_perf.perf_id AND session_id = p_session_id;

    v_draw_results := v_draw_results || jsonb_build_object(
      'performance_id', v_perf.perf_id,
      'order_number', v_order_counter,
      'seed_tier', v_perf.seed_tier,
      'historical_classification', v_perf.historical_classification,
      'draw_group', v_perf.draw_group
    );

    v_order_counter := v_order_counter + 1;
  END LOOP;

  -- 12. Update Session Metadata & Draw Status
  v_new_version := v_session.draw_version + 1;

  UPDATE public.anyo_category_sessions
  SET 
    draw_status = 'GENERATED',
    draw_version = v_new_version,
    draw_generated_at = timezone('utc'::text, now()),
    draw_metadata = jsonb_build_object(
      'generated_by', v_requester_id,
      'generated_at', timezone('utc'::text, now()),
      'is_regeneration', p_is_regeneration,
      'seeding_cutoff_at', v_seeding_cutoff,
      'recency_window_months', 24,
      'total_performers', v_total_performers,
      'tier_distribution', v_tier_counts,
      'draw_version', v_new_version
    ),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  -- 13. System Audit Trail Logging
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
    CASE WHEN p_is_regeneration THEN 'REGENERATE_ANYO_MARCHING_ORDER' ELSE 'GENERATE_ANYO_MARCHING_ORDER' END,
    'ANYO_SESSION',
    p_session_id,
    v_session.tournament_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'draw_version', v_new_version,
      'is_regeneration', p_is_regeneration,
      'seeding_cutoff_at', v_seeding_cutoff,
      'total_performers', v_total_performers,
      'tier_distribution', v_tier_counts,
      'marching_order', v_draw_results
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', p_session_id,
    'draw_status', 'GENERATED',
    'draw_version', v_new_version,
    'total_performers', v_total_performers,
    'tier_distribution', v_tier_counts,
    'seeding_cutoff_at', v_seeding_cutoff,
    'marching_order', v_draw_results
  );
END;
$$;

-- ============================================================================
-- FIX 2, FIX 3, FIX 4: HARDEN MANUAL REORDER (MANDATORY REASON, PERMUTATION VALIDATION, IMMUTABLE CONFIRMED)
-- ============================================================================
-- In reorder_anyo_performances:
-- 1. FIX 4: If draw_status = 'CONFIRMED', reject unconditionally
-- 2. FIX 2: Require non-null, non-empty, non-whitespace p_reason without default fallback
-- 3. FIX 3: Fully validate complete permutation of session performances before any mutation
-- 4. Temporary offset and sequential reordering with full audit diff

CREATE OR REPLACE FUNCTION public.reorder_anyo_performances(
  p_session_id UUID,
  p_performance_ids UUID[],
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_perf_id UUID;
  v_order INT := 1;
  v_active_count INT := 0;
  v_trimmed_reason TEXT;
  v_distinct_input_count INT := 0;
  v_session_perfs_count INT := 0;
  v_matching_perfs_count INT := 0;
  v_before_order JSONB := '[]'::jsonb;
  v_after_order JSONB := '[]'::jsonb;
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to reorder performances'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Lock Session Row
  SELECT * INTO v_session
  FROM public.anyo_category_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session with ID % does not exist', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authorization Check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized for this tournament session'
      USING ERRCODE = '40300';
  END IF;

  -- 4. FIX 4 OF 7: Lock Confirmed Draws Against Manual Reorder
  IF v_session.draw_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Official marching order has already been confirmed and is strictly immutable. Manual reordering is prohibited.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Session Status Validation
  IF v_session.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Performance order cannot be modified once session status is %. Only SCHEDULED sessions can be reordered.', v_session.status
      USING ERRCODE = '22000';
  END IF;

  -- 6. Active Performer Check (Zero tolerance if any performance is active/completed)
  SELECT COUNT(*) INTO v_active_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
    AND status <> 'WAITING'::public.anyo_performance_status;

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot reorder performances because % performer(s) are already active or completed.', v_active_count
      USING ERRCODE = '22000';
  END IF;

  -- 7. FIX 2 OF 7: Make Manual Reorder Reason Truly Mandatory
  v_trimmed_reason := trim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: A non-empty written reason must be explicitly provided for manual performance reordering.'
      USING ERRCODE = '22023';
  END IF;

  -- 8. FIX 3 OF 7: Complete Permutation Validation (Zero Partial Updates / Zero Mutations on Failure)
  -- A. Non-null and non-empty array
  IF p_performance_ids IS NULL OR cardinality(p_performance_ids) = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Performance ID array cannot be null or empty'
      USING ERRCODE = '22023';
  END IF;

  -- B. No duplicate IDs in supplied array
  SELECT COUNT(DISTINCT id_elem) INTO v_distinct_input_count
  FROM unnest(p_performance_ids) AS id_elem;

  IF v_distinct_input_count <> cardinality(p_performance_ids) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Submitted performance ID array contains duplicate IDs'
      USING ERRCODE = '22023';
  END IF;

  -- C. Count total performances belonging to this session
  SELECT COUNT(*) INTO v_session_perfs_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id;

  IF v_session_perfs_count <> cardinality(p_performance_ids) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Submitted performance array count (%) does not match session performance count (%)', cardinality(p_performance_ids), v_session_perfs_count
      USING ERRCODE = '22023';
  END IF;

  -- D. Verify every supplied ID belongs to this session
  SELECT COUNT(*) INTO v_matching_perfs_count
  FROM public.anyo_performances
  WHERE session_id = p_session_id
    AND id = ANY(p_performance_ids);

  IF v_matching_perfs_count <> v_session_perfs_count THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Submitted performance array contains foreign or invalid performance IDs for session %', p_session_id
      USING ERRCODE = '22023';
  END IF;

  -- 9. Capture Before-Order Snapshot for Audit Trail
  SELECT jsonb_agg(
    jsonb_build_object(
      'performance_id', id,
      'order_number', order_number,
      'seed_tier', seed_tier,
      'historical_classification', historical_classification
    ) ORDER BY order_number ASC
  ) INTO v_before_order
  FROM public.anyo_performances
  WHERE session_id = p_session_id;

  -- 10. Temporary offset to avoid unique constraint collisions
  UPDATE public.anyo_performances
  SET order_number = order_number + 50000
  WHERE session_id = p_session_id;

  -- 11. Reassign Sequential Order Numbers from 1 to N
  FOREACH v_perf_id IN ARRAY p_performance_ids LOOP
    UPDATE public.anyo_performances
    SET 
      order_number = v_order,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_perf_id AND session_id = p_session_id;
    
    v_after_order := v_after_order || jsonb_build_object(
      'performance_id', v_perf_id,
      'order_number', v_order
    );

    v_order := v_order + 1;
  END LOOP;

  -- 12. Audit Log of Manual Override with Exact Reason
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
    'MANUAL_REORDER_ANYO_PERFORMANCES',
    'ANYO_SESSION',
    p_session_id,
    v_session.tournament_id,
    jsonb_build_object(
      'reason', v_trimmed_reason,
      'before_order', v_before_order,
      'after_order', v_after_order,
      'reordered_count', v_order - 1
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', p_session_id,
    'reordered_count', v_order - 1,
    'reason', v_trimmed_reason
  );
END;
$$;

-- ============================================================================
-- FIX 7 OF 7: REMOVE ANON ACCESS & HARDEN MARCHING ORDER PREVIEW RPC
-- ============================================================================
-- 1. Revoke EXECUTE from anon
-- 2. Authenticate requester inside RPC
-- 3. Require tournament official authorization

CREATE OR REPLACE FUNCTION public.get_anyo_marching_order_preview(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_performances JSONB;
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to preview marching order'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Session Lookup
  SELECT * INTO v_session
  FROM public.anyo_category_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session with ID % does not exist', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authorization Check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to preview marching order for this session'
      USING ERRCODE = '40300';
  END IF;

  -- 4. Aggregate Performance Order and Metadata
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ap.id,
      'order_number', ap.order_number,
      'status', ap.status,
      'seed_tier', ap.seed_tier,
      'historical_classification', ap.historical_classification,
      'draw_group', ap.draw_group,
      'seed_details', ap.seed_details,
      'seeding_cutoff_at', ap.seeding_cutoff_at,
      'final_score', ap.final_score,
      'final_rank', ap.final_rank,
      'medal_awarded', ap.medal_awarded,
      'athlete_name', p.full_name,
      'athlete_avatar_url', p.avatar_url,
      'team_name', r.team_name,
      'school_club', p.school_club
    ) ORDER BY ap.order_number ASC
  ) INTO v_performances
  FROM public.anyo_performances ap
  JOIN public.registrations r ON r.id = ap.registration_id
  JOIN public.profiles p ON p.id = r.user_id
  WHERE ap.session_id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'draw_status', v_session.draw_status,
    'draw_version', v_session.draw_version,
    'draw_generated_at', v_session.draw_generated_at,
    'draw_confirmed_at', v_session.draw_confirmed_at,
    'draw_metadata', v_session.draw_metadata,
    'performances', COALESCE(v_performances, '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- CORRECTIVE GRANTS & REVOKES
-- ============================================================================

-- Explicitly Revoke anonymous access from preview function
REVOKE EXECUTE ON FUNCTION public.get_anyo_marching_order_preview(UUID) FROM anon;

-- Grant execute exclusively to authenticated officials and service role
GRANT EXECUTE ON FUNCTION public.get_athlete_anyo_seed_tier(UUID, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_anyo_marching_order(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_anyo_marching_order(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_anyo_performances(UUID, UUID[], TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_anyo_marching_order_preview(UUID) TO authenticated, service_role;
