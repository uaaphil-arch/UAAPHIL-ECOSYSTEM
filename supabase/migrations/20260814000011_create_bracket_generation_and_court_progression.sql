-- Migration: 20260814000011_create_bracket_generation_and_court_progression.sql
-- Domain: Deterministic Bracket Generation, Match Scheduling Workflow, and Real-Time Court Progression Engine
-- Project: UAAPHIL Tournament System
-- Target: Supabase / PostgreSQL 15+

-- ====================================================================
-- 1. ADDITIVE COLUMNS ON PUBLIC.MATCHES (NULL-SAFE & NON-DESTRUCTIVE)
-- ====================================================================

DO $$
BEGIN
  -- Add tournament_id FK to matches
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'tournament_id'
  ) THEN
    ALTER TABLE public.matches 
      ADD COLUMN tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE;
  END IF;

  -- Add bracket_node_index to matches for deterministic graph topology
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'bracket_node_index'
  ) THEN
    ALTER TABLE public.matches 
      ADD COLUMN bracket_node_index INT;
  END IF;

  -- Add next_match_id FK to matches for graph parent edge
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'next_match_id'
  ) THEN
    ALTER TABLE public.matches 
      ADD COLUMN next_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL;
  END IF;

  -- Add next_match_corner to matches (RED or BLUE)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'next_match_corner'
  ) THEN
    ALTER TABLE public.matches 
      ADD COLUMN next_match_corner TEXT CHECK (next_match_corner IN ('RED', 'BLUE'));
  END IF;
END $$;

-- ====================================================================
-- 2. PERFORMANCE & TOPOLOGY INDEXES
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_matches_tournament_id 
  ON public.matches(tournament_id);

CREATE INDEX IF NOT EXISTS idx_matches_event_status 
  ON public.matches(event_id, status);

CREATE INDEX IF NOT EXISTS idx_matches_next_match_id 
  ON public.matches(next_match_id);

CREATE INDEX IF NOT EXISTS idx_matches_bracket_node_index 
  ON public.matches(tournament_id, event_id, bracket_node_index);

-- ====================================================================
-- 3. MATCH RESULT VALIDATION GATE (DATABASE-LEVEL INTEGRITY TRIGGER)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.validate_match_completion_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_official_result_exists BOOLEAN;
BEGIN
  -- Gate only applies when status transitions to or is set to COMPLETED
  IF NEW.status = 'COMPLETED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'COMPLETED') THEN
    -- Exception 1: Governed structural BYE match
    IF NEW.court_identifier = 'BYE' AND NEW.winner_registration_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Standard Match Requirement: Must have official match_results entry with matching winner
    SELECT EXISTS (
      SELECT 1 
      FROM public.match_results mr
      WHERE mr.match_id = NEW.id
      AND mr.is_official = TRUE
      AND mr.winner_registration_id = NEW.winner_registration_id
    ) INTO v_official_result_exists;

    IF NOT v_official_result_exists THEN
      RAISE EXCEPTION 'FORBIDDEN: Match % cannot be marked COMPLETED without official finalized match_results', NEW.id
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Disallow illegal state regressions
  IF TG_OP = 'UPDATE' AND OLD.status = 'COMPLETED' AND NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'FORBIDDEN: Completed matches are immutable and cannot regress status'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_match_completion_gate ON public.matches;
CREATE TRIGGER trg_validate_match_completion_gate
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_match_completion_gate();

-- ====================================================================
-- 4. RPC: GENERATE TOURNAMENT BRACKETS (SNAPSHOT-ONLY ENGINE)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.generate_tournament_brackets(
  p_tournament_id UUID
)
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

  -- 5. Process Each Event from the Frozen Snapshot
  FOR v_event IN SELECT * FROM jsonb_to_recordset(v_events_json) AS x(
    id UUID, name TEXT, gender TEXT, division TEXT, category TEXT, weight_class TEXT
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

    -- Only generate brackets for events with at least 2 participants
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

          -- Participant 1 (RED)
          IF v_p1_idx < v_participant_count THEN
            v_p1_reg_id := (v_participants->v_p1_idx->>'id')::uuid;
          ELSE
            v_p1_reg_id := NULL;
          END IF;

          -- Participant 2 (BLUE)
          IF v_p2_idx < v_participant_count THEN
            v_p2_reg_id := (v_participants->v_p2_idx->>'id')::uuid;
          ELSE
            v_p2_reg_id := NULL;
          END IF;

          -- Evaluate BYE
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
        -- Calculate round
        -- Number of nodes at or below this level
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
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'events_processed', v_total_events_processed,
    'matches_generated', v_total_matches_generated,
    'byes_generated', v_total_byes_generated,
    'generated_at', timezone('utc'::text, now())
  );
END;
$$;

-- ====================================================================
-- 5. RPC: ASSIGN MATCH TO COURT (CONCURRENCY-SAFE)
-- ====================================================================

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
  v_requester_status TEXT;
  v_match RECORD;
  v_court RECORD;
  v_existing_assignment_id UUID;
  v_assignment_id UUID;
BEGIN
  -- 1. Authentication & Role Validation
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
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN, ADMIN, or ORGANIZER can assign matches to courts'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Match and Court FOR UPDATE
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
    RAISE EXCEPTION 'INVALID_STATE: Only SCHEDULED matches can be assigned to courts'
      USING ERRCODE = '22000';
  END IF;

  IF v_match.red_corner_registration_id IS NULL OR v_match.blue_corner_registration_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Match cannot be assigned until both athlete corners are populated'
      USING ERRCODE = '22000';
  END IF;

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
    RAISE EXCEPTION 'INVALID_STATE: Target court is inactive'
      USING ERRCODE = '22000';
  END IF;

  IF v_match.tournament_id IS NOT NULL AND v_court.tournament_id <> v_match.tournament_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Court does not belong to the match tournament'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Upsert Court Assignment
  SELECT id
  INTO v_existing_assignment_id
  FROM public.court_assignments
  WHERE match_id = p_match_id
  AND status = 'ASSIGNED'
  LIMIT 1;

  IF v_existing_assignment_id IS NOT NULL THEN
    UPDATE public.court_assignments
    SET 
      court_id = p_court_id,
      assigned_by = v_requester_id,
      assigned_at = timezone('utc'::text, now())
    WHERE id = v_existing_assignment_id
    RETURNING id INTO v_assignment_id;
  ELSE
    INSERT INTO public.court_assignments (
      match_id,
      court_id,
      assigned_by,
      assigned_at,
      status
    ) VALUES (
      p_match_id,
      p_court_id,
      v_requester_id,
      timezone('utc'::text, now()),
      'ASSIGNED'
    )
    RETURNING id INTO v_assignment_id;
  END IF;

  -- Update match court_identifier
  UPDATE public.matches
  SET 
    court_identifier = v_court.identifier,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_match_id;

  -- 4. Audit Log
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
    'ASSIGN_MATCH_TO_COURT',
    'COURT_ASSIGNMENT',
    v_assignment_id,
    v_match.tournament_id,
    jsonb_build_object(
      'match_id', p_match_id,
      'court_id', p_court_id,
      'assignment_id', v_assignment_id,
      'court_identifier', v_court.identifier
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', v_assignment_id,
    'match_id', p_match_id,
    'court_id', p_court_id,
    'court_identifier', v_court.identifier,
    'status', 'ASSIGNED'
  );
END;
$$;

-- ====================================================================
-- 6. RPC: START COURT MATCH (ONE LIVE MATCH PER COURT INVARIANT)
-- ====================================================================

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
  v_requester_role TEXT;
  v_requester_status TEXT;
  v_assignment RECORD;
  v_match RECORD;
  v_court RECORD;
  v_existing_live_count INT;
BEGIN
  -- 1. Authentication & Role Validation
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
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN, ADMIN, or ORGANIZER can start court matches'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Assignment, Court, and Match FOR UPDATE
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
    RAISE EXCEPTION 'INVALID_STATE: Only ASSIGNED court assignments can transition to LIVE'
      USING ERRCODE = '22000';
  END IF;

  SELECT *
  INTO v_court
  FROM public.courts
  WHERE id = v_assignment.court_id
  FOR UPDATE;

  IF v_court.id IS NULL OR NOT v_court.is_active THEN
    RAISE EXCEPTION 'INVALID_STATE: Assigned court is inactive or not found'
      USING ERRCODE = '22000';
  END IF;

  -- Check single live match concurrency invariant
  SELECT COUNT(*)
  INTO v_existing_live_count
  FROM public.court_assignments
  WHERE court_id = v_assignment.court_id
  AND status = 'LIVE';

  IF v_existing_live_count > 0 THEN
    RAISE EXCEPTION 'CONCURRENCY_ERROR: Court % already has an active LIVE match', v_court.identifier
      USING ERRCODE = '23505';
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = v_assignment.match_id
  FOR UPDATE;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Assigned match not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_match.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Match status must be SCHEDULED to start'
      USING ERRCODE = '22000';
  END IF;

  IF v_match.red_corner_registration_id IS NULL OR v_match.blue_corner_registration_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Match cannot start without both athlete corners populated'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Atomic State Transition
  UPDATE public.court_assignments
  SET status = 'LIVE'
  WHERE id = p_court_assignment_id;

  UPDATE public.matches
  SET 
    status = 'IN_PROGRESS',
    updated_at = timezone('utc'::text, now())
  WHERE id = v_assignment.match_id;

  -- 4. Audit Log
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
    'START_COURT_MATCH',
    'MATCH',
    v_match.id,
    v_match.tournament_id,
    jsonb_build_object(
      'match_id', v_match.id,
      'court_id', v_court.id,
      'assignment_id', p_court_assignment_id,
      'court_identifier', v_court.identifier
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'match_id', v_match.id,
    'assignment_id', p_court_assignment_id,
    'court_id', v_court.id,
    'court_identifier', v_court.identifier,
    'match_status', 'IN_PROGRESS',
    'assignment_status', 'LIVE'
  );
END;
$$;

-- ====================================================================
-- 7. RPC: COMPLETE COURT MATCH (RESULT GATE & GRAPH PROPAGATION)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.complete_court_match(
  p_match_id UUID,
  p_winner_registration_id UUID,
  p_decision_type public.decision_type
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role TEXT;
  v_requester_status TEXT;
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

  SELECT ur.role::text, p.status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN, ADMIN, or ORGANIZER can complete court matches'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
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

  IF p_winner_registration_id IS DISTINCT FROM v_match.red_corner_registration_id 
     AND p_winner_registration_id IS DISTINCT FROM v_match.blue_corner_registration_id THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Declared winner must be either RED or BLUE participant'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Upsert Official Match Result (Satisfies Validation Gate Trigger)
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

  -- 4. Complete Match Record
  UPDATE public.matches
  SET 
    winner_registration_id = p_winner_registration_id,
    status = 'COMPLETED',
    updated_at = timezone('utc'::text, now())
  WHERE id = p_match_id;

  -- 5. Release Active Court Assignment to COMPLETED
  UPDATE public.court_assignments
  SET 
    status = 'COMPLETED'
  WHERE match_id = p_match_id
  AND status = 'LIVE';

  -- 6. Atomic Graph Progression: Advance Winner to Next Match Node
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
    v_requester_role,
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

-- ====================================================================
-- 8. RPC: CANCEL MATCH ASSIGNMENT (QUEUE ROLLBACK)
-- ====================================================================

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
  v_requester_role TEXT;
  v_requester_status TEXT;
  v_assignment RECORD;
  v_match RECORD;
BEGIN
  -- 1. Authentication & Role Validation
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
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN, ADMIN, or ORGANIZER can cancel match assignments'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Assignment and Match FOR UPDATE
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
    RAISE EXCEPTION 'INVALID_STATE: Only ASSIGNED (not LIVE or COMPLETED) court assignments can be cancelled'
      USING ERRCODE = '22000';
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = v_assignment.match_id
  FOR UPDATE;

  -- 3. Delete Assignment and Reset Match Court Identifier
  DELETE FROM public.court_assignments
  WHERE id = p_court_assignment_id;

  IF v_match.id IS NOT NULL AND v_match.status = 'SCHEDULED' THEN
    UPDATE public.matches
    SET 
      court_identifier = NULL,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_match.id;
  END IF;

  -- 4. Audit Log
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
    'CANCEL_COURT_ASSIGNMENT',
    'COURT_ASSIGNMENT',
    p_court_assignment_id,
    v_match.tournament_id,
    jsonb_build_object(
      'assignment_id', p_court_assignment_id,
      'match_id', v_match.id,
      'reason', p_reason
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', p_court_assignment_id,
    'match_id', v_match.id,
    'status', 'CANCELLED_AND_UNASSIGNED'
  );
END;
$$;

-- ====================================================================
-- 9. EXPLICIT FUNCTION EXECUTION GRANTS & REVOCATIONS
-- ====================================================================

REVOKE ALL ON FUNCTION public.validate_match_completion_gate() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.generate_tournament_brackets(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_match_to_court(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_match_to_court(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.start_court_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_court_match(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_court_match(UUID, UUID, public.decision_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_court_match(UUID, UUID, public.decision_type) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_match_assignment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_match_assignment(UUID, TEXT) TO authenticated;
