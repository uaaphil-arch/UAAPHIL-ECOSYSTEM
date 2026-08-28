-- ====================================================================
-- UAAPHIL TOURNAMENT SYSTEM
-- Migration: 20260816000014_harden_anyo_bracket_isolation.sql
-- Description: Hardens generate_tournament_brackets() to strictly exclude
--              Anyo categories from single-elimination sparring brackets.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.generate_tournament_brackets(
  p_tournament_id UUID
)
-- Returns diagnostic JSON summary: total events, total matches, total byes
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role TEXT;
  v_requester_status TEXT;
  v_tournament RECORD;
  v_snapshot_config JSONB;
  v_events_json JSONB;
  v_registrations_json JSONB;
  v_event RECORD;
  v_event_id UUID;
  v_active_matches_count INT;
  v_total_events_processed INT := 0;
  v_total_matches_generated INT := 0;
  v_total_byes_generated INT := 0;
  
  -- Sizing & Bracket vars
  v_participants JSONB;
  v_participant_count INT;
  v_bracket_size INT;
  v_rounds INT;
  v_total_nodes INT;
  v_byes INT;
  v_r INT;
  v_m INT;
  v_node_idx INT;
  v_match_id UUID;
  v_p1_idx INT;
  v_p2_idx INT;
  v_p1_reg_id UUID;
  v_p2_reg_id UUID;
  v_is_bye BOOLEAN;
  v_winner_id UUID;
  v_parent_node_idx INT;
  v_parent_match_id UUID;
  v_parent_corner TEXT;
  
  -- Array of generated match UUIDs mapped by bracket_node_index
  v_node_map JSONB := '{}'::jsonb;
BEGIN
  -- 1. Authentication & Active Status Verification
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT ur.role::text, p.status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN or ADMIN can generate tournament brackets'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Target Tournament Row FOR UPDATE
  SELECT *
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status NOT IN ('ONGOING', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Brackets can only be generated for tournaments in ONGOING or REGISTRATION_CLOSED status'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Retrieve Frozen Snapshot Configuration
  SELECT configuration
  INTO v_snapshot_config
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_snapshot_config IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament must be locked and snapshotted before bracket generation'
      USING ERRCODE = '22000';
  END IF;

  v_events_json := v_snapshot_config->'events';
  v_registrations_json := v_snapshot_config->'registrations';

  IF v_events_json IS NULL OR jsonb_array_length(v_events_json) = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: Snapshot contains no configured events'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Idempotency Check: Reject if active or completed matches exist
  SELECT COUNT(*)
  INTO v_active_matches_count
  FROM public.matches
  WHERE tournament_id = p_tournament_id
  AND status IN ('IN_PROGRESS', 'COMPLETED')
  AND court_identifier IS DISTINCT FROM 'BYE';

  IF v_active_matches_count > 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot regenerate brackets while matches are IN_PROGRESS or COMPLETED'
      USING ERRCODE = '22000';
  END IF;

  -- Purge existing SCHEDULED matches (and initial BYEs) strictly for this tournament
  DELETE FROM public.matches
  WHERE tournament_id = p_tournament_id;

  -- 5. Process Each Event from the Frozen Snapshot (STRICTLY SPARRED FULL-CONTACT ONLY)
  FOR v_event IN 
    SELECT * 
    FROM jsonb_to_recordset(v_events_json) AS x(
      id UUID, name TEXT, gender TEXT, division TEXT, category TEXT, weight_class TEXT
    )
    WHERE (
      x.category NOT ILIKE 'Anyo%'
      AND x.category NOT ILIKE 'Team%'
      AND x.category NOT IN (
        'Anyo Solo Baston',
        'Anyo Doble Baston',
        'Anyo Espada y Daga',
        'Anyo Solo Espada',
        'Team Solo Baston',
        'Team Doble Baston',
        'Team Espada y Daga',
        'Team Espada'
      )
    )
  LOOP
    v_event_id := v_event.id;
    v_node_map := '{}'::jsonb;

    -- Extract and filter approved registrations belonging to this snapshot event
    -- Deterministic sorting: explicit seed if present, otherwise created_at ASC, id ASC
    SELECT COALESCE(jsonb_agg(elem ORDER BY 
      COALESCE((elem->>'seed')::int, 999999),
      (elem->>'created_at') ASC,
      (elem->>'id') ASC
    ), '[]'::jsonb)
    INTO v_participants
    FROM jsonb_array_elements(v_registrations_json) elem
    WHERE (elem->>'event_id')::uuid = v_event_id;

    v_participant_count := jsonb_array_length(v_participants);

    -- Only generate brackets for sparring events with at least 2 participants
    IF v_participant_count >= 2 THEN
      -- Sizing to power of 2: 2, 4, 8, 16, 32, 64
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

      -- Phase A: Pre-insert empty match nodes for all rounds (from Finals down to Round 1)
      -- node_index: 1 = Final, 2..3 = Semifinals, etc.
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
          1, -- updated in Phase D
          v_node_idx,
          v_node_idx,
          'SCHEDULED',
          timezone('utc'::text, now()),
          timezone('utc'::text, now())
        )
        RETURNING id INTO v_match_id;

        v_node_map := jsonb_set(v_node_map, ARRAY[v_node_idx::text], to_jsonb(v_match_id::text));
        v_total_matches_generated := v_total_matches_generated + 1;
      END LOOP;

      -- Phase B: Wire parent edges (next_match_id and next_match_corner)
      -- For a binary tree of size S-1 nodes:
      -- Node 1 has no parent.
      -- Node K (K > 1) has parent floor(K / 2).
      -- If K is even (2, 4, 6...) -> corner is RED.
      -- If K is odd (3, 5, 7...) -> corner is BLUE.
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

      -- Phase C: Compute canonical binary tournament seed slots
      -- Recursive doubling formula: start with [1, 2], iteratively expand x -> [x, 2^k + 1 - x]
      DECLARE
        v_seed_slots INT[] := ARRAY[1, 2];
        v_temp_slots INT[];
        v_slot_val INT;
        v_step INT;
        v_sum INT;
        v_p1_seed INT;
        v_p2_seed INT;
      BEGIN
        IF v_rounds > 1 THEN
          FOR v_step IN 2..v_rounds LOOP
            v_temp_slots := ARRAY[]::INT[];
            v_sum := (2^v_step)::int + 1;
            FOREACH v_slot_val IN ARRAY v_seed_slots LOOP
              v_temp_slots := array_append(v_temp_slots, v_slot_val);
              v_temp_slots := array_append(v_temp_slots, v_sum - v_slot_val);
            END LOOP;
            v_seed_slots := v_temp_slots;
          END LOOP;
        END IF;

        -- Populate Round 1 matches and handle BYE advancement
        -- Round 1 nodes are located at indices: (v_bracket_size / 2) to (v_bracket_size - 1)
        FOR v_m IN 1..(v_bracket_size / 2) LOOP
          v_node_idx := (v_bracket_size / 2) - 1 + v_m;
          v_match_id := (v_node_map->>v_node_idx::text)::uuid;

          v_p1_seed := v_seed_slots[(v_m - 1) * 2 + 1];
          v_p2_seed := v_seed_slots[(v_m - 1) * 2 + 2];

          v_p1_idx := v_p1_seed - 1;
          v_p2_idx := v_p2_seed - 1;

          v_p1_reg_id := NULL;
          v_p2_reg_id := NULL;

          IF v_p1_idx < v_participant_count THEN
            v_p1_reg_id := (v_participants->v_p1_idx->>'id')::uuid;
          END IF;

          IF v_p2_idx < v_participant_count THEN
            v_p2_reg_id := (v_participants->v_p2_idx->>'id')::uuid;
          END IF;

          -- BYE Check: If exactly one corner is present, that corner wins immediately
          IF v_p1_reg_id IS NOT NULL AND v_p2_reg_id IS NULL THEN
            v_is_bye := TRUE;
            v_winner_id := v_p1_reg_id;
          ELSIF v_p1_reg_id IS NULL AND v_p2_reg_id IS NOT NULL THEN
            v_is_bye := TRUE;
            v_winner_id := v_p2_reg_id;
          ELSE
            v_is_bye := FALSE;
            v_winner_id := NULL;
          END IF;

          IF v_is_bye THEN
            v_total_byes_generated := v_total_byes_generated + 1;
            
            -- Complete the BYE node structurally
            UPDATE public.matches
            SET 
              round_number = 1,
              match_number = v_m,
              red_corner_registration_id = v_p1_reg_id,
              blue_corner_registration_id = v_p2_reg_id,
              winner_registration_id = v_winner_id,
              status = 'COMPLETED',
              court_identifier = 'BYE',
              updated_at = timezone('utc'::text, now())
            WHERE id = v_match_id;

            -- Immediately propagate lone athlete to parent match node if parent exists
            IF v_node_idx > 1 THEN
              v_parent_node_idx := v_node_idx / 2;
              v_parent_match_id := (v_node_map->>v_parent_node_idx::text)::uuid;
              
              IF (v_node_idx % 2) = 0 THEN
                UPDATE public.matches
                SET red_corner_registration_id = v_winner_id
                WHERE id = v_parent_match_id;
              ELSE
                UPDATE public.matches
                SET blue_corner_registration_id = v_winner_id
                WHERE id = v_parent_match_id;
              END IF;
            END IF;
          ELSE
            -- Normal Round 1 Match
            UPDATE public.matches
            SET 
              round_number = 1,
              match_number = v_m,
              red_corner_registration_id = v_p1_reg_id,
              blue_corner_registration_id = v_p2_reg_id,
              status = 'SCHEDULED',
              updated_at = timezone('utc'::text, now())
            WHERE id = v_match_id;
          END IF;
        END LOOP;
      END;

      -- Phase D: Update correct round_number on remaining upper round match nodes
      -- For a tree:
      -- Node 1: Round R (Final)
      -- Nodes 2..3: Round R-1 (Semifinals)
      -- Nodes 4..7: Round R-2, etc.
      FOR v_node_idx IN 1..((v_bracket_size / 2) - 1) LOOP
        v_r := v_rounds - floor(log(2, v_node_idx))::int;
        v_match_id := (v_node_map->>v_node_idx::text)::uuid;

        UPDATE public.matches
        SET 
          round_number = v_r,
          match_number = v_node_idx - (2^(v_rounds - v_r)::int - 1)
        WHERE id = v_match_id;
      END LOOP;

      v_total_events_processed := v_total_events_processed + 1;
    END IF;
  END LOOP;

  -- 6. Write System Audit Log Entry
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
    'TOURNAMENT_BRACKET',
    p_tournament_id,
    p_tournament_id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'events_processed', v_total_events_processed,
      'matches_generated', v_total_matches_generated,
      'byes_generated', v_total_byes_generated
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'events_processed', v_total_events_processed,
    'matches_generated', v_total_matches_generated,
    'byes_generated', v_total_byes_generated,
    'status', 'SUCCESS'
  );
END;
$$;
