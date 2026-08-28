-- ============================================================================
-- Migration: 20260827000051_reconcile_bracket_lineup_role_filter.sql
-- Description: Reconcile participant selection in generate_tournament_brackets
--              to strictly require COALESCE(r.lineup_role, 'LINEUP') = 'LINEUP'.
--              This defensively prevents approved RESERVE or WITHDRAWN
--              registrations from being seeded into elimination brackets.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_tournament_brackets(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role TEXT;
  v_requester_status public.account_status;
  v_tournament RECORD;
  v_active_snapshot_id UUID;
  v_event RECORD;
  v_event_id UUID;
  v_participants JSONB;
  v_participant_count INT;
  v_bracket_size INT;
  v_rounds INT;
  v_total_nodes INT;
  v_byes INT;
  v_node_idx INT;
  v_match_id UUID;
  v_node_map JSONB;
  v_parent_node_idx INT;
  v_parent_match_id UUID;
  v_parent_corner TEXT;
  v_seed INT;
  v_pair_idx INT;
  v_leaf_start_node INT;
  v_leaf_end_node INT;
  v_leaf_count INT;
  v_total_matches_generated INT := 0;
  v_active_matches_count INT := 0;
  v_events_processed INT := 0;
  v_p_red RECORD;
  v_p_blue RECORD;
  v_pair_p1 JSONB;
  v_pair_p2 JSONB;
BEGIN
  -- 1. Authenticate and verify admin privileges
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT ur.role::text, p.account_status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN or ADMIN can generate tournament brackets' USING ERRCODE = '40300';
  END IF;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active' USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Target Tournament Row FOR UPDATE
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status NOT IN ('ONGOING', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Brackets can only be generated for tournaments in ONGOING or REGISTRATION_CLOSED status'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Retrieve Active Snapshot ID
  SELECT id INTO v_active_snapshot_id
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id AND is_active = TRUE
  ORDER BY version DESC
  LIMIT 1;

  IF v_active_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament must have an active snapshot before bracket generation'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Idempotency Check: Reject if active or completed matches exist
  SELECT COUNT(*) INTO v_active_matches_count
  FROM public.matches
  WHERE tournament_id = p_tournament_id
  AND status IN ('IN_PROGRESS'::public.match_status, 'COMPLETED'::public.match_status)
  AND court_identifier IS DISTINCT FROM 'BYE';

  IF v_active_matches_count > 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot regenerate brackets while matches are IN_PROGRESS or COMPLETED'
      USING ERRCODE = '22000';
  END IF;

  -- Purge existing dependent records and SCHEDULED matches strictly for this tournament
  DELETE FROM public.court_assignments 
  WHERE match_id IN (SELECT id FROM public.matches WHERE tournament_id = p_tournament_id);

  DELETE FROM public.match_results 
  WHERE match_id IN (SELECT id FROM public.matches WHERE tournament_id = p_tournament_id);

  DELETE FROM public.matches
  WHERE tournament_id = p_tournament_id;

  -- 5. Process Each Event from Relational Database (STRICTLY FULL-CONTACT SPARRED EVENTS)
  FOR v_event IN 
    SELECT e.id, e.name, e.gender, e.division, e.category, e.weight_class, e.bracket_system
    FROM public.events e
    WHERE e.snapshot_id = v_active_snapshot_id
      AND e.category NOT ILIKE 'Anyo%'
      AND e.category NOT ILIKE 'Team%'
      AND e.category NOT IN (
        'Anyo Solo Baston',
        'Anyo Doble Baston',
        'Anyo Espada y Daga',
        'Anyo Solo Espada',
        'Team Solo Baston',
        'Team Doble Baston',
        'Team Espada y Daga',
        'Team Espada'
      )
  LOOP
    v_event_id := v_event.id;
    v_node_map := '{}'::jsonb;
    v_events_processed := v_events_processed + 1;

    -- Extract approved registrations belonging to this event with explicit LINEUP role verification
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'event_id', r.event_id,
        'user_id', r.user_id,
        'team_name', r.team_name,
        'created_at', r.created_at
      ) ORDER BY r.created_at ASC, r.id ASC
    ), '[]'::jsonb)
    INTO v_participants
    FROM public.registrations r
    WHERE r.event_id = v_event_id
      AND r.is_approved = TRUE
      AND COALESCE(r.lineup_role, 'LINEUP') = 'LINEUP';

    v_participant_count := jsonb_array_length(v_participants);

    -- Only generate brackets for sparring events with at least 2 participants
    IF v_participant_count >= 2 THEN
      IF v_participant_count <= 2 THEN
        v_bracket_size := 2;
        v_rounds := 1;
      ELSIF v_participant_count <= 4 THEN
        v_bracket_size := 4;
        v_rounds := 2;
      ELSIF v_participant_count <= 8 THEN
        v_bracket_size := 8;
        v_rounds := 3;
      ELSIF v_participant_count <= 16 THEN
        v_bracket_size := 16;
        v_rounds := 4;
      ELSIF v_participant_count <= 32 THEN
        v_bracket_size := 32;
        v_rounds := 5;
      ELSIF v_participant_count <= 64 THEN
        v_bracket_size := 64;
        v_rounds := 6;
      ELSE
        RAISE EXCEPTION 'INVALID_STATE: Bracket participant count % exceeds supported maximum of 64', v_participant_count
          USING ERRCODE = '22000';
      END IF;

      v_total_nodes := v_bracket_size - 1;
      v_byes := v_bracket_size - v_participant_count;

      -- Phase A: Pre-insert empty match nodes for all rounds (Finals down to Round 1)
      FOR v_node_idx IN 1..v_total_nodes LOOP
        INSERT INTO public.matches (
          tournament_id,
          event_id,
          round_number,
          match_number,
          bracket_node_index,
          status,
          created_at,
          updated_at
        ) VALUES (
          p_tournament_id,
          v_event_id,
          1,
          v_node_idx,
          v_node_idx,
          'SCHEDULED'::public.match_status,
          NOW(),
          NOW()
        )
        RETURNING id INTO v_match_id;

        v_node_map := jsonb_set(v_node_map, ARRAY[v_node_idx::text], to_jsonb(v_match_id::text));
        v_total_matches_generated := v_total_matches_generated + 1;
      END LOOP;

      -- Phase B: Wire parent edges (next_match_id and next_match_corner)
      FOR v_node_idx IN 2..v_total_nodes LOOP
        v_parent_node_idx := v_node_idx / 2;
        v_parent_match_id := (v_node_map->>v_parent_node_idx::text)::uuid;
        
        IF (v_node_idx % 2) = 0 THEN
          v_parent_corner := 'RED';
        ELSE
          v_parent_corner := 'BLUE';
        END IF;

        UPDATE public.matches
        SET 
          next_match_id = v_parent_match_id,
          next_match_corner = v_parent_corner
        WHERE id = (v_node_map->>v_node_idx::text)::uuid;
      END LOOP;

      -- Phase C: Seed participants into leaf matches
      v_leaf_start_node := v_bracket_size / 2;
      v_leaf_end_node := v_total_nodes;
      v_leaf_count := v_bracket_size / 2;

      FOR v_pair_idx IN 0..(v_leaf_count - 1) LOOP
        v_node_idx := v_leaf_start_node + v_pair_idx;
        v_match_id := (v_node_map->>v_node_idx::text)::uuid;

        IF (v_pair_idx * 2) < v_participant_count THEN
          v_pair_p1 := v_participants->(v_pair_idx * 2);
        ELSE
          v_pair_p1 := NULL;
        END IF;

        IF (v_pair_idx * 2 + 1) < v_participant_count THEN
          v_pair_p2 := v_participants->(v_pair_idx * 2 + 1);
        ELSE
          v_pair_p2 := NULL;
        END IF;

        IF v_pair_p1 IS NOT NULL AND v_pair_p2 IS NOT NULL THEN
          -- Normal Match
          UPDATE public.matches
          SET 
            red_corner_registration_id = (v_pair_p1->>'id')::uuid,
            blue_corner_registration_id = (v_pair_p2->>'id')::uuid
          WHERE id = v_match_id;
        ELSIF v_pair_p1 IS NOT NULL AND v_pair_p2 IS NULL THEN
          -- Automatic BYE Progression for P1
          UPDATE public.matches
          SET 
            red_corner_registration_id = (v_pair_p1->>'id')::uuid,
            blue_corner_registration_id = NULL,
            winner_registration_id = (v_pair_p1->>'id')::uuid,
            status = 'COMPLETED'::public.match_status,
            court_identifier = 'BYE'
          WHERE id = v_match_id;

          -- Advance P1 to parent node
          SELECT * INTO v_tournament FROM public.matches WHERE id = v_match_id;
          IF v_tournament.next_match_id IS NOT NULL THEN
            IF v_tournament.next_match_corner = 'RED' THEN
              UPDATE public.matches
              SET red_corner_registration_id = (v_pair_p1->>'id')::uuid
              WHERE id = v_tournament.next_match_id;
            ELSE
              UPDATE public.matches
              SET blue_corner_registration_id = (v_pair_p1->>'id')::uuid
              WHERE id = v_tournament.next_match_id;
            END IF;
          END IF;
        END IF;
      END LOOP;

      -- Phase D: Compute and update correct round numbers
      FOR v_node_idx IN 1..v_total_nodes LOOP
        UPDATE public.matches
        SET round_number = v_rounds - floor(log(2, v_node_idx))::int
        WHERE id = (v_node_map->>v_node_idx::text)::uuid;
      END LOOP;
    END IF;
  END LOOP;

  -- 6. Write System Audit Log
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
    v_requester_role,
    'GENERATE_TOURNAMENT_BRACKETS',
    'tournaments',
    p_tournament_id,
    p_tournament_id,
    jsonb_build_object(
      'total_matches_generated', v_total_matches_generated,
      'events_processed', v_events_processed,
      'snapshot_id', v_active_snapshot_id
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'snapshot_id', v_active_snapshot_id,
    'total_matches_generated', v_total_matches_generated,
    'events_processed', v_events_processed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated, service_role;
