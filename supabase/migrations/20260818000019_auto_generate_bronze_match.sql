-- Migration: 20260818000019_auto_generate_bronze_match.sql
-- Domain: Mandatory Automated Bronze Match Generation for Full Contact (Option A: SINGLE_ELIMINATION_BRONZE_BOUT)
-- Project: UAAPHIL Tournament System
-- Target: Supabase / PostgreSQL 15+
-- Invariants Preserved from Production:
--   1. Function signature includes DEFAULT 'POINTS' for p_decision_type
--   2. Preserves public.is_authorized_tournament_official(...) security check
--   3. Preserves completed_at timestamp on court_assignments
--   4. Preserves FOR UPDATE row locking, match_results upsert, and winner next-node progression
--   5. Invariant Option B (SINGLE_ELIMINATION_TWO_BRONZE) remains 100% untouched (no Bronze match generated)
--   6. Strict Audit Trail (AUTO_GENERATE_BRONZE_MATCH logged to system_audit_logs)
--   7. Race-Condition Protection (UNIQUE index on event_id, bracket_node_index)
--   8. Consistent Walkover/BYE Data Model (auto-completed if 1 loser is BYE)
--   9. Immutability Protection (blocks re-finalization overwrite if Bronze Match is LIVE or COMPLETED)
--   10. Strict Snapshot-First Binding: MATCH -> EVENT -> EVENT.snapshot_id -> AUTHORITATIVE SNAPSHOT

-- ====================================================================
-- 1. PRE-CHECK FOR DUPLICATE (event_id, bracket_node_index) RECORDS
-- ====================================================================

DO $$
DECLARE
  v_dup_count INT;
BEGIN
  SELECT COUNT(*)
  INTO v_dup_count
  FROM (
    SELECT event_id, bracket_node_index, COUNT(*)
    FROM public.matches
    WHERE event_id IS NOT NULL AND bracket_node_index IS NOT NULL
    GROUP BY event_id, bracket_node_index
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_HALTED: Found % existing duplicate (event_id, bracket_node_index) pairs in public.matches. Please resolve duplicates before applying unique constraint.', v_dup_count
      USING ERRCODE = '23505';
  END IF;
END $$;

-- ====================================================================
-- 2. CREATE UNIQUE INDEX ON PUBLIC.MATCHES (event_id, bracket_node_index)
-- ====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_event_bracket_node_index 
  ON public.matches(event_id, bracket_node_index)
  WHERE event_id IS NOT NULL AND bracket_node_index IS NOT NULL;

-- ====================================================================
-- 3. RECONCILE public.complete_court_match WITH AUTOMATED BRONZE MATCH GENERATION
-- ====================================================================

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

  -- Bronze Match Generation variables
  v_event_snapshot_id UUID;
  v_snapshot_config JSONB;
  v_bracket_system TEXT;
  v_semi1 RECORD;
  v_semi2 RECORD;
  v_semi1_loser_reg_id UUID;
  v_semi2_loser_reg_id UUID;
  v_existing_bronze RECORD;
  v_bronze_match_id UUID;
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

  -- 3. Check Authorization (Preserved from Production)
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

  -- 6. Release Active Court Assignment to COMPLETED (Preserved completed_at)
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

  -- ====================================================================
  -- 8. MANDATORY AUTOMATED BRONZE MATCH GENERATION (OPTION A CHECK)
  -- ====================================================================
  -- If completed match is a Semifinal (node 2 or node 3), check if Option A applies
  IF v_match.bracket_node_index IN (2, 3) AND v_match.event_id IS NOT NULL THEN
    -- A. Fetch authoritative snapshot bound specifically to this event (Strict Snapshot-First V7)
    SELECT snapshot_id INTO v_event_snapshot_id
    FROM public.events
    WHERE id = v_match.event_id;

    IF v_event_snapshot_id IS NOT NULL THEN
      SELECT configuration INTO v_snapshot_config
      FROM public.tournament_snapshots
      WHERE id = v_event_snapshot_id;
    ELSE
      -- Fallback to active tournament snapshot if event.snapshot_id is not yet populated
      SELECT configuration INTO v_snapshot_config
      FROM public.tournament_snapshots
      WHERE tournament_id = v_match.tournament_id
      AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    -- B. Resolve Bracket System
    v_bracket_system := COALESCE(
      (
        SELECT elem->'rules_override'->>'bracket_model'
        FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
        WHERE (elem->>'id')::uuid = v_match.event_id
        LIMIT 1
      ),
      (
        SELECT elem->'rules_override'->>'bracket_system'
        FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
        WHERE (elem->>'id')::uuid = v_match.event_id
        LIMIT 1
      ),
      (
        SELECT elem->'bracket_system'
        FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
        WHERE (elem->>'id')::uuid = v_match.event_id
        LIMIT 1
      ),
      'SINGLE_ELIMINATION_TWO_BRONZE'
    );

    IF v_bracket_system IN ('SINGLE_ELIMINATION_BRONZE_BOUT', 'WITH_BATTLE_FOR_BRONZE') THEN
      -- C. Check if BOTH Semifinals (node 2 and node 3) are now COMPLETED
      SELECT * INTO v_semi1 FROM public.matches 
      WHERE event_id = v_match.event_id AND bracket_node_index = 2;

      SELECT * INTO v_semi2 FROM public.matches 
      WHERE event_id = v_match.event_id AND bracket_node_index = 3;

      IF v_semi1.id IS NOT NULL AND v_semi1.status = 'COMPLETED' AND
         v_semi2.id IS NOT NULL AND v_semi2.status = 'COMPLETED' THEN

        -- Identify losers
        v_semi1_loser_reg_id := CASE 
          WHEN v_semi1.winner_registration_id = v_semi1.red_corner_registration_id THEN v_semi1.blue_corner_registration_id
          ELSE v_semi1.red_corner_registration_id
        END;

        v_semi2_loser_reg_id := CASE 
          WHEN v_semi2.winner_registration_id = v_semi2.red_corner_registration_id THEN v_semi2.blue_corner_registration_id
          ELSE v_semi2.red_corner_registration_id
        END;

        -- Check existing Bronze Match (bracket_node_index = 0)
        SELECT * INTO v_existing_bronze
        FROM public.matches
        WHERE event_id = v_match.event_id AND bracket_node_index = 0
        FOR UPDATE;

        IF v_existing_bronze.id IS NOT NULL THEN
          -- Immutability Protection: If Bronze Match is already LIVE or COMPLETED, block silent mutation
          IF v_existing_bronze.status IN ('IN_PROGRESS', 'COMPLETED') THEN
            IF (v_existing_bronze.red_corner_registration_id IS DISTINCT FROM v_semi1_loser_reg_id) OR
               (v_existing_bronze.blue_corner_registration_id IS DISTINCT FROM v_semi2_loser_reg_id) THEN
              RAISE EXCEPTION 'FORBIDDEN: Cannot modify Bronze Match participants because Bronze Match is already % (Match ID: %). A formal administrative correction workflow is required.',
                v_existing_bronze.status, v_existing_bronze.id
                USING ERRCODE = '42501';
            END IF;
          ELSE
            -- Bronze Match is SCHEDULED: safely update corner registrations if needed
            UPDATE public.matches
            SET
              red_corner_registration_id = v_semi1_loser_reg_id,
              blue_corner_registration_id = v_semi2_loser_reg_id,
              updated_at = timezone('utc'::text, now())
            WHERE id = v_existing_bronze.id;
          END IF;

        ELSE
          -- D. Create Bronze Match node (bracket_node_index = 0)
          -- Case 1: Both losers are present (Standard Battle for Bronze)
          IF v_semi1_loser_reg_id IS NOT NULL AND v_semi2_loser_reg_id IS NOT NULL THEN
            INSERT INTO public.matches (
              tournament_id,
              event_id,
              round_number,
              round_name,
              match_number,
              bracket_node_index,
              red_corner_registration_id,
              blue_corner_registration_id,
              status,
              court_identifier,
              created_at,
              updated_at
            ) VALUES (
              v_match.tournament_id,
              v_match.event_id,
              v_match.round_number,
              'Battle for Bronze',
              0,
              0,
              v_semi1_loser_reg_id,
              v_semi2_loser_reg_id,
              'SCHEDULED',
              NULL,
              timezone('utc'::text, now()),
              timezone('utc'::text, now())
            )
            ON CONFLICT (event_id, bracket_node_index) DO NOTHING
            RETURNING id INTO v_bronze_match_id;

            -- Audit log
            IF v_bronze_match_id IS NOT NULL THEN
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
                'AUTO_GENERATE_BRONZE_MATCH',
                'MATCH',
                v_bronze_match_id,
                v_match.tournament_id,
                jsonb_build_object(
                  'event_id', v_match.event_id,
                  'bracket_node_index', 0,
                  'round_name', 'Battle for Bronze',
                  'semi1_match_id', v_semi1.id,
                  'semi2_match_id', v_semi2.id,
                  'red_corner_registration_id', v_semi1_loser_reg_id,
                  'blue_corner_registration_id', v_semi2_loser_reg_id,
                  'reason', 'DUAL_SEMIFINAL_COMPLETION_OPTION_A'
                ),
                timezone('utc'::text, now())
              );
            END IF;

          -- Case 2: One loser is NULL due to BYE (Auto-completed Walkover Bronze)
          ELSIF (v_semi1_loser_reg_id IS NOT NULL AND v_semi2_loser_reg_id IS NULL) OR
                (v_semi1_loser_reg_id IS NULL AND v_semi2_loser_reg_id IS NOT NULL) THEN
            
            DECLARE
              v_walkover_winner UUID := COALESCE(v_semi1_loser_reg_id, v_semi2_loser_reg_id);
            BEGIN
              INSERT INTO public.matches (
                tournament_id,
                event_id,
                round_number,
                round_name,
                match_number,
                bracket_node_index,
                red_corner_registration_id,
                blue_corner_registration_id,
                winner_registration_id,
                status,
                court_identifier,
                created_at,
                updated_at
              ) VALUES (
                v_match.tournament_id,
                v_match.event_id,
                v_match.round_number,
                'Battle for Bronze',
                0,
                0,
                v_walkover_winner,
                NULL,
                v_walkover_winner,
                'COMPLETED',
                'BYE',
                timezone('utc'::text, now()),
                timezone('utc'::text, now())
              )
              ON CONFLICT (event_id, bracket_node_index) DO NOTHING
              RETURNING id INTO v_bronze_match_id;

              IF v_bronze_match_id IS NOT NULL THEN
                -- Insert official result for walkover
                INSERT INTO public.match_results (
                  match_id,
                  winner_registration_id,
                  decision_type,
                  is_official,
                  finalized_by,
                  finalized_at
                ) VALUES (
                  v_bronze_match_id,
                  v_walkover_winner,
                  'DEFAULT',
                  TRUE,
                  v_requester_id,
                  timezone('utc'::text, now())
                );

                -- Audit log for walkover bronze
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
                  'AUTO_GENERATE_BRONZE_WALKOVER',
                  'MATCH',
                  v_bronze_match_id,
                  v_match.tournament_id,
                  jsonb_build_object(
                    'event_id', v_match.event_id,
                    'bracket_node_index', 0,
                    'round_name', 'Battle for Bronze (Walkover / BYE)',
                    'winner_registration_id', v_walkover_winner,
                    'reason', 'SEMIFINAL_BYE_WALKOVER_OPTION_A'
                  ),
                  timezone('utc'::text, now())
                );
              END IF;
            END;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 9. Main Audit Log
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
