-- ==============================================================================
-- UAAPHIL MIGRATION 15: RANKINGS & MEDAL TALLY ENGINE
-- ==============================================================================
-- Non-destructive, additive RPC aggregation engine.
-- Consumes authoritative finalized competition results from Anyo (anyo_category_sessions.status = 'FINALIZED')
-- and Sparring (matches.status = 'COMPLETED' with match_results).
-- Adheres strictly to the Tournament Snapshot Rule and Deterministic Olympic Standard Ranking.
-- ==============================================================================

-- 1. Helper function: Get Event Podiums for a Tournament
CREATE OR REPLACE FUNCTION public.get_tournament_event_podiums(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_events_result JSONB := '[]'::jsonb;
  v_snapshot_config JSONB;
  v_event RECORD;
  v_anyo_session RECORD;
  v_gold RECORD;
  v_silver RECORD;
  v_bronze RECORD;
  v_final_match RECORD;
  v_semi1_loser_reg_id UUID;
  v_semi2_loser_reg_id UUID;
  v_bronze_match RECORD;
  v_bracket_system TEXT;
  v_event_obj JSONB;
  v_bronze_list JSONB;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 1. Retrieve Frozen Snapshot Configuration for Bracket Rules
  SELECT configuration INTO v_snapshot_config
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Guard against missing snapshot or empty events
  IF v_snapshot_config IS NULL OR v_snapshot_config->'events' IS NULL OR jsonb_array_length(v_snapshot_config->'events') = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 2. Iterate over all active events from the frozen Tournament Snapshot
  FOR v_event IN
    SELECT 
      x.id, 
      x.name, 
      x.gender,
      x.division,
      x.category,
      x.weight_class,
      (
        LOWER(COALESCE(x.name, '')) LIKE '%anyo%' OR 
        LOWER(COALESCE(x.name, '')) LIKE '%form%' OR 
        LOWER(COALESCE(x.category, '')) LIKE '%anyo%' OR
        LOWER(COALESCE(x.weight_class, '')) LIKE '%anyo%'
      ) AS is_anyo
    FROM jsonb_to_recordset(v_snapshot_config->'events') AS x(
      id UUID,
      name TEXT,
      gender TEXT,
      division TEXT,
      category TEXT,
      weight_class TEXT
    )
    ORDER BY x.name ASC
  LOOP
    v_bronze_list := '[]'::jsonb;

    IF v_event.is_anyo THEN
      -- Check Anyo Category Session
      SELECT * INTO v_anyo_session
      FROM public.anyo_category_sessions
      WHERE event_id = v_event.id AND tournament_id = p_tournament_id;

      IF v_anyo_session.id IS NOT NULL AND v_anyo_session.status = 'FINALIZED' THEN
        -- Gold Winner
        SELECT 
          ap.registration_id,
          ap.performer_name AS athlete_name,
          ap.school_club AS team_name,
          ap.final_score
        INTO v_gold
        FROM public.anyo_performances ap
        WHERE ap.session_id = v_anyo_session.id AND ap.medal_awarded = 'GOLD'
        LIMIT 1;

        -- Silver Winner
        SELECT 
          ap.registration_id,
          ap.performer_name AS athlete_name,
          ap.school_club AS team_name,
          ap.final_score
        INTO v_silver
        FROM public.anyo_performances ap
        WHERE ap.session_id = v_anyo_session.id AND ap.medal_awarded = 'SILVER'
        LIMIT 1;

        -- Bronze Winner(s)
        FOR v_bronze IN
          SELECT 
            ap.registration_id,
            ap.performer_name AS athlete_name,
            ap.school_club AS team_name,
            ap.final_score
          FROM public.anyo_performances ap
          WHERE ap.session_id = v_anyo_session.id AND ap.medal_awarded = 'BRONZE'
        LOOP
          v_bronze_list := v_bronze_list || jsonb_build_object(
            'registration_id', v_bronze.registration_id,
            'athlete_name', v_bronze.athlete_name,
            'team_name', v_bronze.team_name,
            'final_score', v_bronze.final_score
          );
        END LOOP;

        v_event_obj := jsonb_build_object(
          'event_id', v_event.id,
          'event_name', v_event.name,
          'gender_category', v_event.gender,
          'weight_category', COALESCE(v_event.weight_class, v_event.category),
          'is_anyo', true,
          'status', 'FINALIZED',
          'gold_winner', CASE WHEN v_gold.registration_id IS NOT NULL THEN jsonb_build_object(
            'registration_id', v_gold.registration_id,
            'athlete_name', v_gold.athlete_name,
            'team_name', v_gold.team_name,
            'final_score', v_gold.final_score
          ) ELSE NULL END,
          'silver_winner', CASE WHEN v_silver.registration_id IS NOT NULL THEN jsonb_build_object(
            'registration_id', v_silver.registration_id,
            'athlete_name', v_silver.athlete_name,
            'team_name', v_silver.team_name,
            'final_score', v_silver.final_score
          ) ELSE NULL END,
          'bronze_winners', v_bronze_list
        );
      ELSE
        v_event_obj := jsonb_build_object(
          'event_id', v_event.id,
          'event_name', v_event.name,
          'gender_category', v_event.gender,
          'weight_category', COALESCE(v_event.weight_class, v_event.category),
          'is_anyo', true,
          'status', COALESCE(v_anyo_session.status, 'PENDING'),
          'gold_winner', NULL,
          'silver_winner', NULL,
          'bronze_winners', '[]'::jsonb
        );
      END IF;

    ELSE
      -- Sparring / Full Contact Event: Check Final Match (bracket_node_index = 1)
      SELECT m.*, mr.winner_registration_id, mr.is_official
      INTO v_final_match
      FROM public.matches m
      LEFT JOIN public.match_results mr ON mr.match_id = m.id AND mr.is_official = true
      WHERE m.event_id = v_event.id 
        AND m.tournament_id = p_tournament_id 
        AND m.bracket_node_index = 1;

      IF v_final_match.id IS NOT NULL AND v_final_match.status = 'COMPLETED' AND v_final_match.winner_registration_id IS NOT NULL THEN
        -- Gold Winner
        SELECT 
          r.id AS registration_id,
          COALESCE(p.full_name, 'Athlete') AS athlete_name,
          COALESCE(p.school_club, r.school_name, 'Club') AS team_name
        INTO v_gold
        FROM public.registrations r
        LEFT JOIN public.profiles p ON p.id = r.athlete_id
        WHERE r.id = v_final_match.winner_registration_id;

        -- Silver Winner (other corner in Final)
        SELECT 
          r.id AS registration_id,
          COALESCE(p.full_name, 'Athlete') AS athlete_name,
          COALESCE(p.school_club, r.school_name, 'Club') AS team_name
        INTO v_silver
        FROM public.registrations r
        LEFT JOIN public.profiles p ON p.id = r.athlete_id
        WHERE r.id = CASE 
          WHEN v_final_match.winner_registration_id = v_final_match.red_corner_registration_id 
          THEN v_final_match.blue_corner_registration_id 
          ELSE v_final_match.red_corner_registration_id 
        END;

        -- Resolve Bracket System from Snapshot (defaults to TWO_BRONZE_NO_BATTLE)
        v_bracket_system := COALESCE(
          (
            SELECT elem->'rules_override'->>'bracket_system'
            FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
            WHERE (elem->>'id')::uuid = v_event.id
            LIMIT 1
          ),
          (
            SELECT elem->'category_configuration'->>'bracket_system'
            FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
            WHERE (elem->>'id')::uuid = v_event.id
            LIMIT 1
          ),
          (
            SELECT elem->>'bracket_system'
            FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
            WHERE (elem->>'id')::uuid = v_event.id
            LIMIT 1
          ),
          'TWO_BRONZE_NO_BATTLE'
        );

        -- Identify Semifinal 1 Loser (bracket_node_index = 2)
        SELECT CASE 
          WHEN mr.winner_registration_id = m.red_corner_registration_id THEN m.blue_corner_registration_id
          ELSE m.red_corner_registration_id
        END INTO v_semi1_loser_reg_id
        FROM public.matches m
        JOIN public.match_results mr ON mr.match_id = m.id AND mr.is_official = true
        WHERE m.event_id = v_event.id 
          AND m.tournament_id = p_tournament_id 
          AND m.bracket_node_index = 2
          AND m.status = 'COMPLETED';

        -- Identify Semifinal 2 Loser (bracket_node_index = 3)
        SELECT CASE 
          WHEN mr.winner_registration_id = m.red_corner_registration_id THEN m.blue_corner_registration_id
          ELSE m.red_corner_registration_id
        END INTO v_semi2_loser_reg_id
        FROM public.matches m
        JOIN public.match_results mr ON mr.match_id = m.id AND mr.is_official = true
        WHERE m.event_id = v_event.id 
          AND m.tournament_id = p_tournament_id 
          AND m.bracket_node_index = 3
          AND m.status = 'COMPLETED';

        IF v_bracket_system = 'WITH_BATTLE_FOR_BRONZE' THEN
          -- WITH_BATTLE_FOR_BRONZE Rule:
          -- Only the winner of the Bronze Match receives Bronze (1 Bronze total).
          -- Bronze Match is identified by: completed match between the two semifinal losers,
          -- or match assigned with bracket_node_index = 0 / dedicated 3rd place match.
          SELECT m.*, mr.winner_registration_id
          INTO v_bronze_match
          FROM public.matches m
          JOIN public.match_results mr ON mr.match_id = m.id AND mr.is_official = true
          WHERE m.event_id = v_event.id 
            AND m.tournament_id = p_tournament_id 
            AND m.bracket_node_index NOT IN (1, 2, 3)
            AND (
              (v_semi1_loser_reg_id IS NOT NULL AND v_semi2_loser_reg_id IS NOT NULL AND (
                (m.red_corner_registration_id = v_semi1_loser_reg_id AND m.blue_corner_registration_id = v_semi2_loser_reg_id)
                OR (m.red_corner_registration_id = v_semi2_loser_reg_id AND m.blue_corner_registration_id = v_semi1_loser_reg_id)
              ))
              OR (m.bracket_node_index = 0)
            )
            AND m.status = 'COMPLETED'
          LIMIT 1;

          IF v_bronze_match.winner_registration_id IS NOT NULL THEN
            SELECT 
              r.id AS registration_id,
              COALESCE(p.full_name, 'Athlete') AS athlete_name,
              COALESCE(p.school_club, r.school_name, 'Club') AS team_name
            INTO v_bronze
            FROM public.registrations r
            LEFT JOIN public.profiles p ON p.id = r.athlete_id
            WHERE r.id = v_bronze_match.winner_registration_id;

            IF v_bronze.registration_id IS NOT NULL THEN
              v_bronze_list := v_bronze_list || jsonb_build_object(
                'registration_id', v_bronze.registration_id,
                'athlete_name', v_bronze.athlete_name,
                'team_name', v_bronze.team_name,
                'final_score', NULL
              );
            END IF;
          END IF;

        ELSE
          -- TWO_BRONZE_NO_BATTLE Rule (Default):
          -- Both Semifinal losers receive Bronze medals (2 Bronze total).
          IF v_semi1_loser_reg_id IS NOT NULL THEN
            SELECT 
              r.id AS registration_id,
              COALESCE(p.full_name, 'Athlete') AS athlete_name,
              COALESCE(p.school_club, r.school_name, 'Club') AS team_name
            INTO v_bronze
            FROM public.registrations r
            LEFT JOIN public.profiles p ON p.id = r.athlete_id
            WHERE r.id = v_semi1_loser_reg_id;

            IF v_bronze.registration_id IS NOT NULL THEN
              v_bronze_list := v_bronze_list || jsonb_build_object(
                'registration_id', v_bronze.registration_id,
                'athlete_name', v_bronze.athlete_name,
                'team_name', v_bronze.team_name,
                'final_score', NULL
              );
            END IF;
          END IF;

          IF v_semi2_loser_reg_id IS NOT NULL THEN
            SELECT 
              r.id AS registration_id,
              COALESCE(p.full_name, 'Athlete') AS athlete_name,
              COALESCE(p.school_club, r.school_name, 'Club') AS team_name
            INTO v_bronze
            FROM public.registrations r
            LEFT JOIN public.profiles p ON p.id = r.athlete_id
            WHERE r.id = v_semi2_loser_reg_id;

            IF v_bronze.registration_id IS NOT NULL THEN
              v_bronze_list := v_bronze_list || jsonb_build_object(
                'registration_id', v_bronze.registration_id,
                'athlete_name', v_bronze.athlete_name,
                'team_name', v_bronze.team_name,
                'final_score', NULL
              );
            END IF;
          END IF;
        END IF;

        v_event_obj := jsonb_build_object(
          'event_id', v_event.id,
          'event_name', v_event.name,
          'gender_category', v_event.gender,
          'weight_category', COALESCE(v_event.weight_class, v_event.category),
          'is_anyo', false,
          'status', 'COMPLETED',
          'bracket_system', v_bracket_system,
          'gold_winner', CASE WHEN v_gold.registration_id IS NOT NULL THEN jsonb_build_object(
            'registration_id', v_gold.registration_id,
            'athlete_name', v_gold.athlete_name,
            'team_name', v_gold.team_name
          ) ELSE NULL END,
          'silver_winner', CASE WHEN v_silver.registration_id IS NOT NULL THEN jsonb_build_object(
            'registration_id', v_silver.registration_id,
            'athlete_name', v_silver.athlete_name,
            'team_name', v_silver.team_name
          ) ELSE NULL END,
          'bronze_winners', v_bronze_list
        );
      ELSE
        v_event_obj := jsonb_build_object(
          'event_id', v_event.id,
          'event_name', v_event.name,
          'gender_category', v_event.gender,
          'weight_category', COALESCE(v_event.weight_class, v_event.category),
          'is_anyo', false,
          'status', COALESCE(v_final_match.status, 'PENDING'),
          'gold_winner', NULL,
          'silver_winner', NULL,
          'bronze_winners', '[]'::jsonb
        );
      END IF;
    END IF;

    v_events_result := v_events_result || v_event_obj;
  END LOOP;

  RETURN v_events_result;
END;
$$;

-- 2. Team / Club Medal Tally Function (Olympic Standard Ordering)
CREATE OR REPLACE FUNCTION public.get_tournament_medal_tally(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_podiums JSONB;
  v_event JSONB;
  v_bronze JSONB;
  v_tally_map JSONB := '{}'::jsonb;
  v_team_key TEXT;
  v_current_item JSONB;
  v_result JSONB := '[]'::jsonb;
  v_team RECORD;
  v_rank INT := 1;
  v_prev_gold INT := -1;
  v_prev_silver INT := -1;
  v_prev_bronze INT := -1;
  v_display_rank TEXT;
BEGIN
  -- Get all finalized event podiums
  v_podiums := public.get_tournament_event_podiums(p_tournament_id);

  -- Process podium outcomes into team aggregations
  FOR v_event IN SELECT * FROM jsonb_array_elements(v_podiums)
  LOOP
    IF (v_event->>'status') IN ('FINALIZED', 'COMPLETED') THEN
      -- Gold
      IF v_event->'gold_winner' IS NOT NULL AND v_event->'gold_winner' != 'null'::jsonb THEN
        v_team_key := COALESCE(v_event->'gold_winner'->>'team_name', 'Independent');
        v_current_item := COALESCE(v_tally_map->v_team_key, jsonb_build_object(
          'team_name', v_team_key,
          'school_club', v_team_key,
          'gold_count', 0,
          'silver_count', 0,
          'bronze_count', 0,
          'total_medals', 0
        ));
        v_current_item := jsonb_set(v_current_item, '{gold_count}', to_jsonb((v_current_item->>'gold_count')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
        v_tally_map := jsonb_set(v_tally_map, array[v_team_key], v_current_item);
      END IF;

      -- Silver
      IF v_event->'silver_winner' IS NOT NULL AND v_event->'silver_winner' != 'null'::jsonb THEN
        v_team_key := COALESCE(v_event->'silver_winner'->>'team_name', 'Independent');
        v_current_item := COALESCE(v_tally_map->v_team_key, jsonb_build_object(
          'team_name', v_team_key,
          'school_club', v_team_key,
          'gold_count', 0,
          'silver_count', 0,
          'bronze_count', 0,
          'total_medals', 0
        ));
        v_current_item := jsonb_set(v_current_item, '{silver_count}', to_jsonb((v_current_item->>'silver_count')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
        v_tally_map := jsonb_set(v_tally_map, array[v_team_key], v_current_item);
      END IF;

      -- Bronze list
      IF v_event->'bronze_winners' IS NOT NULL THEN
        FOR v_bronze IN SELECT * FROM jsonb_array_elements(v_event->'bronze_winners')
        LOOP
          v_team_key := COALESCE(v_bronze->>'team_name', 'Independent');
          v_current_item := COALESCE(v_tally_map->v_team_key, jsonb_build_object(
            'team_name', v_team_key,
            'school_club', v_team_key,
            'gold_count', 0,
            'silver_count', 0,
            'bronze_count', 0,
            'total_medals', 0
          ));
          v_current_item := jsonb_set(v_current_item, '{bronze_count}', to_jsonb((v_current_item->>'bronze_count')::int + 1));
          v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
          v_tally_map := jsonb_set(v_tally_map, array[v_team_key], v_current_item);
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  -- Convert map to sorted array with deterministic ranking and tie labels
  CREATE TEMP TABLE temp_team_tally (
    team_name TEXT,
    school_club TEXT,
    gold_count INT,
    silver_count INT,
    bronze_count INT,
    total_medals INT
  ) ON COMMIT DROP;

  INSERT INTO temp_team_tally
  SELECT 
    val->>'team_name',
    val->>'school_club',
    (val->>'gold_count')::int,
    (val->>'silver_count')::int,
    (val->>'bronze_count')::int,
    (val->>'total_medals')::int
  FROM jsonb_each(v_tally_map) AS t(k, val);

  FOR v_team IN
    SELECT *,
      DENSE_RANK() OVER (ORDER BY gold_count DESC, silver_count DESC, bronze_count DESC, total_medals DESC) AS rnk,
      COUNT(*) OVER (PARTITION BY gold_count, silver_count, bronze_count, total_medals) AS tie_count
    FROM temp_team_tally
    ORDER BY gold_count DESC, silver_count DESC, bronze_count DESC, total_medals DESC, team_name ASC
  LOOP
    IF v_team.tie_count > 1 THEN
      v_display_rank := 'T-' || v_team.rnk::text;
    ELSE
      v_display_rank := v_team.rnk::text;
    END IF;

    v_result := v_result || jsonb_build_object(
      'team_name', v_team.team_name,
      'school_club', v_team.school_club,
      'gold_count', v_team.gold_count,
      'silver_count', v_team.silver_count,
      'bronze_count', v_team.bronze_count,
      'total_medals', v_team.total_medals,
      'rank', v_team.rnk,
      'rank_display', v_display_rank,
      'is_tied', (v_team.tie_count > 1)
    );
  END LOOP;

  DROP TABLE IF EXISTS temp_team_tally;
  RETURN v_result;
END;
$$;

-- 3. Athlete Individual Standings Function
CREATE OR REPLACE FUNCTION public.get_tournament_athlete_standings(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_podiums JSONB;
  v_event JSONB;
  v_bronze JSONB;
  v_athlete_map JSONB := '{}'::jsonb;
  v_ath_key TEXT;
  v_current_item JSONB;
  v_result JSONB := '[]'::jsonb;
  v_ath RECORD;
  v_display_rank TEXT;
BEGIN
  v_podiums := public.get_tournament_event_podiums(p_tournament_id);

  FOR v_event IN SELECT * FROM jsonb_array_elements(v_podiums)
  LOOP
    IF (v_event->>'status') IN ('FINALIZED', 'COMPLETED') THEN
      -- Gold
      IF v_event->'gold_winner' IS NOT NULL AND v_event->'gold_winner' != 'null'::jsonb THEN
        v_ath_key := v_event->'gold_winner'->>'registration_id';
        v_current_item := COALESCE(v_athlete_map->v_ath_key, jsonb_build_object(
          'registration_id', v_ath_key,
          'athlete_name', v_event->'gold_winner'->>'athlete_name',
          'team_name', v_event->'gold_winner'->>'team_name',
          'gold_count', 0,
          'silver_count', 0,
          'bronze_count', 0,
          'total_medals', 0,
          'events_won', 0,
          'events_participated', 0
        ));
        v_current_item := jsonb_set(v_current_item, '{gold_count}', to_jsonb((v_current_item->>'gold_count')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{events_won}', to_jsonb((v_current_item->>'events_won')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{events_participated}', to_jsonb((v_current_item->>'events_participated')::int + 1));
        v_athlete_map := jsonb_set(v_athlete_map, array[v_ath_key], v_current_item);
      END IF;

      -- Silver
      IF v_event->'silver_winner' IS NOT NULL AND v_event->'silver_winner' != 'null'::jsonb THEN
        v_ath_key := v_event->'silver_winner'->>'registration_id';
        v_current_item := COALESCE(v_athlete_map->v_ath_key, jsonb_build_object(
          'registration_id', v_ath_key,
          'athlete_name', v_event->'silver_winner'->>'athlete_name',
          'team_name', v_event->'silver_winner'->>'team_name',
          'gold_count', 0,
          'silver_count', 0,
          'bronze_count', 0,
          'total_medals', 0,
          'events_won', 0,
          'events_participated', 0
        ));
        v_current_item := jsonb_set(v_current_item, '{silver_count}', to_jsonb((v_current_item->>'silver_count')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
        v_current_item := jsonb_set(v_current_item, '{events_participated}', to_jsonb((v_current_item->>'events_participated')::int + 1));
        v_athlete_map := jsonb_set(v_athlete_map, array[v_ath_key], v_current_item);
      END IF;

      -- Bronze
      IF v_event->'bronze_winners' IS NOT NULL THEN
        FOR v_bronze IN SELECT * FROM jsonb_array_elements(v_event->'bronze_winners')
        LOOP
          v_ath_key := v_bronze->>'registration_id';
          v_current_item := COALESCE(v_athlete_map->v_ath_key, jsonb_build_object(
            'registration_id', v_ath_key,
            'athlete_name', v_bronze->>'athlete_name',
            'team_name', v_bronze->>'team_name',
            'gold_count', 0,
            'silver_count', 0,
            'bronze_count', 0,
            'total_medals', 0,
            'events_won', 0,
            'events_participated', 0
          ));
          v_current_item := jsonb_set(v_current_item, '{bronze_count}', to_jsonb((v_current_item->>'bronze_count')::int + 1));
          v_current_item := jsonb_set(v_current_item, '{total_medals}', to_jsonb((v_current_item->>'total_medals')::int + 1));
          v_current_item := jsonb_set(v_current_item, '{events_participated}', to_jsonb((v_current_item->>'events_participated')::int + 1));
          v_athlete_map := jsonb_set(v_athlete_map, array[v_ath_key], v_current_item);
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  CREATE TEMP TABLE temp_ath_standings (
    registration_id TEXT,
    athlete_name TEXT,
    team_name TEXT,
    gold_count INT,
    silver_count INT,
    bronze_count INT,
    total_medals INT,
    events_participated INT,
    events_won INT
  ) ON COMMIT DROP;

  INSERT INTO temp_ath_standings
  SELECT 
    val->>'registration_id',
    val->>'athlete_name',
    val->>'team_name',
    (val->>'gold_count')::int,
    (val->>'silver_count')::int,
    (val->>'bronze_count')::int,
    (val->>'total_medals')::int,
    (val->>'events_participated')::int,
    (val->>'events_won')::int
  FROM jsonb_each(v_athlete_map) AS t(k, val);

  FOR v_ath IN
    SELECT *,
      DENSE_RANK() OVER (ORDER BY gold_count DESC, silver_count DESC, bronze_count DESC, total_medals DESC) AS rnk,
      COUNT(*) OVER (PARTITION BY gold_count, silver_count, bronze_count, total_medals) AS tie_count
    FROM temp_ath_standings
    ORDER BY gold_count DESC, silver_count DESC, bronze_count DESC, total_medals DESC, athlete_name ASC
  LOOP
    IF v_ath.tie_count > 1 THEN
      v_display_rank := 'T-' || v_ath.rnk::text;
    ELSE
      v_display_rank := v_ath.rnk::text;
    END IF;

    v_result := v_result || jsonb_build_object(
      'athlete_id', v_ath.registration_id,
      'registration_id', v_ath.registration_id,
      'athlete_name', v_ath.athlete_name,
      'team_name', v_ath.team_name,
      'gold_count', v_ath.gold_count,
      'silver_count', v_ath.silver_count,
      'bronze_count', v_ath.bronze_count,
      'total_medals', v_ath.total_medals,
      'events_participated', v_ath.events_participated,
      'events_won', v_ath.events_won,
      'rank', v_ath.rnk,
      'rank_display', v_display_rank,
      'is_tied', (v_ath.tie_count > 1)
    );
  END LOOP;

  DROP TABLE IF EXISTS temp_ath_standings;
  RETURN v_result;
END;
$$;

-- 4. Tournament Standings Summary Function
CREATE OR REPLACE FUNCTION public.get_tournament_standings_summary(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tourney RECORD;
  v_podiums JSONB;
  v_event JSONB;
  v_total_events INT := 0;
  v_finalized_events INT := 0;
  v_gold INT := 0;
  v_silver INT := 0;
  v_bronze INT := 0;
  v_teams_count INT := 0;
  v_athletes_count INT := 0;
BEGIN
  SELECT * INTO v_tourney FROM public.tournaments WHERE id = p_tournament_id;
  IF v_tourney.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Tournament not found');
  END IF;

  v_podiums := public.get_tournament_event_podiums(p_tournament_id);

  FOR v_event IN SELECT * FROM jsonb_array_elements(v_podiums)
  LOOP
    v_total_events := v_total_events + 1;
    IF (v_event->>'status') IN ('FINALIZED', 'COMPLETED') THEN
      v_finalized_events := v_finalized_events + 1;
      IF v_event->'gold_winner' IS NOT NULL AND v_event->'gold_winner' != 'null'::jsonb THEN
        v_gold := v_gold + 1;
      END IF;
      IF v_event->'silver_winner' IS NOT NULL AND v_event->'silver_winner' != 'null'::jsonb THEN
        v_silver := v_silver + 1;
      END IF;
      IF v_event->'bronze_winners' IS NOT NULL THEN
        v_bronze := v_bronze + jsonb_array_length(v_event->'bronze_winners');
      END IF;
    END IF;
  END LOOP;

  -- Count teams & athletes registered
  SELECT COUNT(DISTINCT school_name) INTO v_teams_count
  FROM public.registrations WHERE tournament_id = p_tournament_id;

  SELECT COUNT(DISTINCT athlete_id) INTO v_athletes_count
  FROM public.registrations WHERE tournament_id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id', v_tourney.id,
    'tournament_name', v_tourney.name,
    'status', v_tourney.status,
    'is_provisional', (v_finalized_events < v_total_events OR v_total_events = 0),
    'total_events', v_total_events,
    'finalized_events', v_finalized_events,
    'total_gold_awarded', v_gold,
    'total_silver_awarded', v_silver,
    'total_bronze_awarded', v_bronze,
    'total_medals_awarded', (v_gold + v_silver + v_bronze),
    'teams_competing', v_teams_count,
    'athletes_competing', v_athletes_count
  );
END;
$$;

-- Grant Execution Rights
GRANT EXECUTE ON FUNCTION public.get_tournament_event_podiums(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_medal_tally(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_athlete_standings(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_standings_summary(UUID) TO anon, authenticated, service_role;
