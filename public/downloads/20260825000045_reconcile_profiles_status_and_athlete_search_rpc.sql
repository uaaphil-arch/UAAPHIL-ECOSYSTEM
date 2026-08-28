-- ==============================================================================
-- MIGRATION 20260825000045: RECONCILE PROFILES.STATUS AND ATHLETE SEARCH RPC
-- ==============================================================================
-- Description:
-- Reconciles database functions and queries that had schema drift referencing
-- non-existent physical column `public.profiles.account_status` (SQLSTATE 42703).
-- Enforces canonical physical column `public.profiles.status` across all active RPCs:
-- 1. public.search_athletes_for_coach
-- 2. public.coach_add_player_membership
-- 3. public.coach_set_event_lineup
-- 4. public.is_authorized_tournament_official
-- 5. public.assign_event_role
-- 6. public.generate_tournament_brackets
--
-- Security & Safety:
-- - All functions are SECURITY DEFINER with explicit SET search_path = public, pg_temp.
-- - RBAC checks, caller authentication, and PII protection strictly preserved.
-- - Non-destructive, forward-only migration. Baseline migration 000044 left untouched.
-- ==============================================================================

-- 1. Reconcile search_athletes_for_coach
CREATE OR REPLACE FUNCTION public.search_athletes_for_coach(
  p_query TEXT
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  affiliation_status TEXT,
  active_club_id UUID,
  active_club_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_coach BOOLEAN;
  v_is_admin BOOLEAN;
  v_clean_query TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '40100: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- Verify caller has COACH or ADMIN / SUPER_ADMIN role
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id
      AND ur.role IN ('COACH', 'ADMIN', 'SUPER_ADMIN')
  ) INTO v_is_coach;

  IF NOT v_is_coach THEN
    RAISE EXCEPTION '42501 FORBIDDEN: Insufficient privileges. Only coaches and administrators may search athlete registry.'
      USING ERRCODE = '42501';
  END IF;

  v_clean_query := TRIM(p_query);
  -- Short query guard: require at least 2 characters
  IF length(v_clean_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    p.id AS user_id,
    p.full_name,
    CASE 
      WHEN cm.id IS NOT NULL AND cm.status = 'ACTIVE' THEN 'ACTIVE_MEMBER'
      WHEN cm.id IS NOT NULL AND cm.status = 'PENDING' THEN 'PENDING_MEMBER'
      ELSE 'UNATTACHED'
    END AS affiliation_status,
    c.id AS active_club_id,
    c.name AS active_club_name
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'
  LEFT JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.status = 'ACTIVE'
  LEFT JOIN public.clubs c ON c.id = cm.club_id
  WHERE p.status = 'ACTIVE'
    AND (
      p.full_name ILIKE ('%' || v_clean_query || '%')
    )
  ORDER BY p.full_name ASC
  LIMIT 25;
END;
$$;

REVOKE ALL ON FUNCTION public.search_athletes_for_coach(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_athletes_for_coach(TEXT) TO authenticated;


-- 2. Reconcile coach_add_player_membership
CREATE OR REPLACE FUNCTION public.coach_add_player_membership(
  p_club_id UUID,
  p_player_user_id UUID,
  p_membership_type TEXT DEFAULT 'REGULAR',
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_has_authority BOOLEAN;
  v_is_super_admin BOOLEAN;
  v_player_valid BOOLEAN;
  v_existing_active_id UUID;
  v_existing_active_club_id UUID;
  v_new_membership_id UUID;
  v_effective_date DATE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '40100: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 1. Check Super Admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id AND ur.role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  -- 2. Check Coach Authority for club
  IF NOT v_is_super_admin THEN
    SELECT public.get_coach_team_authority(v_caller_id, p_club_id) INTO v_has_authority;
    IF NOT v_has_authority THEN
      RAISE EXCEPTION '42501 FORBIDDEN: Caller does not possess active coach authority for this club.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Verify Target Athlete exists, has PLAYER role, and is ACTIVE
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    INNER JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'
    WHERE p.id = p_player_user_id
      AND p.status = 'ACTIVE'
  ) INTO v_player_valid;

  IF NOT v_player_valid THEN
    RAISE EXCEPTION '42200 INELIGIBLE_ATHLETE: Target user does not exist or does not hold an active PLAYER account.'
      USING ERRCODE = '42200';
  END IF;

  -- 4. Check Global Single Active Membership Invariant
  SELECT cm.id, cm.club_id INTO v_existing_active_id, v_existing_active_club_id
  FROM public.club_memberships cm
  WHERE cm.player_user_id = p_player_user_id
    AND cm.status = 'ACTIVE'
  LIMIT 1;

  IF v_existing_active_id IS NOT NULL THEN
    IF v_existing_active_club_id = p_club_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'membership_id', v_existing_active_id,
        'status', 'ACTIVE',
        'message', 'Athlete is already an active member of this club.'
      );
    ELSE
      RAISE EXCEPTION '23505 ALREADY_ACTIVE_MEMBER: Athlete is already an active member of another club. A formal player transfer is required.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 5. Insert new ACTIVE membership
  v_effective_date := CURRENT_DATE;
  INSERT INTO public.club_memberships (
    club_id,
    player_user_id,
    membership_type,
    status,
    effective_from,
    requested_by,
    approved_by,
    reviewed_at,
    review_notes
  ) VALUES (
    p_club_id,
    p_player_user_id,
    p_membership_type,
    'ACTIVE',
    v_effective_date,
    v_caller_id,
    v_caller_id,
    NOW(),
    COALESCE(p_notes, 'Direct coach addition to club roster')
  )
  RETURNING id INTO v_new_membership_id;

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_new_membership_id,
    'status', 'ACTIVE',
    'effective_from', v_effective_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.coach_add_player_membership(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_add_player_membership(UUID, UUID, TEXT, TEXT) TO authenticated;


-- 3. Reconcile coach_set_event_lineup
CREATE OR REPLACE FUNCTION public.coach_set_event_lineup(
  p_event_id UUID,
  p_club_id UUID,
  p_lineup_user_ids UUID[],
  p_reserve_user_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_has_authority BOOLEAN;
  v_is_super_admin BOOLEAN;
  v_tournament_id UUID;
  v_tournament_status TEXT;
  v_uid UUID;
  v_club_name TEXT;
  v_lineup_count INTEGER := 0;
  v_reserve_count INTEGER := 0;
  v_active_membership_exists BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '40100: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- Check Super Admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id AND ur.role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  -- Check Coach Authority
  IF NOT v_is_super_admin THEN
    SELECT public.get_coach_team_authority(v_caller_id, p_club_id) INTO v_has_authority;
    IF NOT v_has_authority THEN
      RAISE EXCEPTION '42501 FORBIDDEN: Caller does not possess active coach authority for this club.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Check Tournament Lifecycle Lock
  SELECT e.tournament_id, t.status, c.name
  INTO v_tournament_id, v_tournament_status, v_club_name
  FROM public.events e
  INNER JOIN public.tournaments t ON t.id = e.tournament_id
  LEFT JOIN public.clubs c ON c.id = p_club_id
  WHERE e.id = p_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'P0002 NOT_FOUND: Event not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament_status IN ('ONGOING', 'COMPLETED') THEN
    RAISE EXCEPTION '22023 INVALID_STATE: Tournament is locked (% status). Roster modifications are forbidden.', v_tournament_status
      USING ERRCODE = '22023';
  END IF;

  -- Ensure disjoint lineup and reserve sets
  IF p_lineup_user_ids && p_reserve_user_ids THEN
    RAISE EXCEPTION '22000 INVALID_ARGUMENT: An athlete cannot be simultaneously designated as LINEUP and RESERVE.'
      USING ERRCODE = '22000';
  END IF;

  -- Verify active club membership and active profile status for all LINEUP candidates
  IF p_lineup_user_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.club_memberships cm
        INNER JOIN public.profiles p ON p.id = cm.player_user_id
        WHERE cm.player_user_id = v_uid
          AND cm.club_id = p_club_id
          AND cm.status = 'ACTIVE'
          AND p.status = 'ACTIVE'
      ) INTO v_active_membership_exists;

      IF NOT v_active_membership_exists THEN
        RAISE EXCEPTION '42200 INELIGIBLE_ATHLETE: User % is not an active verified member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- Verify active club membership and active profile status for all RESERVE candidates
  IF p_reserve_user_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.club_memberships cm
        INNER JOIN public.profiles p ON p.id = cm.player_user_id
        WHERE cm.player_user_id = v_uid
          AND cm.club_id = p_club_id
          AND cm.status = 'ACTIVE'
          AND p.status = 'ACTIVE'
      ) INTO v_active_membership_exists;

      IF NOT v_active_membership_exists THEN
        RAISE EXCEPTION '42200 INELIGIBLE_ATHLETE: User % is not an active verified member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- Mark unlisted registrations for this club and event as WITHDRAWN
  UPDATE public.registrations
  SET lineup_role = 'WITHDRAWN',
      updated_at = NOW()
  WHERE event_id = p_event_id
    AND club_id = p_club_id
    AND user_id NOT IN (
      SELECT unnest(COALESCE(p_lineup_user_ids, ARRAY[]::UUID[]) || COALESCE(p_reserve_user_ids, ARRAY[]::UUID[]))
    )
    AND lineup_role <> 'WITHDRAWN';

  -- Upsert LINEUP entries
  IF p_lineup_user_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        COALESCE(v_club_name, 'Club Team'),
        'LINEUP',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET lineup_role = 'LINEUP',
          club_id = p_club_id,
          team_name = COALESCE(v_club_name, public.registrations.team_name),
          is_approved = true,
          updated_at = NOW();

      v_lineup_count := v_lineup_count + 1;
    END LOOP;
  END IF;

  -- Upsert RESERVE entries
  IF p_reserve_user_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        COALESCE(v_club_name, 'Club Team'),
        'RESERVE',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET lineup_role = 'RESERVE',
          club_id = p_club_id,
          team_name = COALESCE(v_club_name, public.registrations.team_name),
          is_approved = true,
          updated_at = NOW();

      v_reserve_count := v_reserve_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'club_id', p_club_id,
    'lineup_count', v_lineup_count,
    'reserve_count', v_reserve_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) TO authenticated;


-- 4. Reconcile is_authorized_tournament_official
CREATE OR REPLACE FUNCTION public.is_authorized_tournament_official(
  p_user_id UUID,
  p_tournament_id UUID,
  p_event_id UUID DEFAULT NULL,
  p_court_id UUID DEFAULT NULL,
  p_allow_court_manager BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_user_status TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Check User Account Status from public.profiles
  SELECT p.status INTO v_user_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_user_status IS NULL OR v_user_status <> 'ACTIVE' THEN
    RETURN FALSE;
  END IF;

  -- 2. Check Global Roles (SUPER_ADMIN, ADMIN)
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'SUPER_ADMIN'),
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'ADMIN')
  INTO v_is_super_admin, v_is_admin;

  IF v_is_super_admin OR v_is_admin THEN
    RETURN TRUE;
  END IF;

  -- 3. Check Tournament Organizer / Manager Ownership
  IF p_tournament_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tournaments
      WHERE id = p_tournament_id
        AND organizer_id = p_user_id
    ) INTO v_is_organizer;

    IF v_is_organizer THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 4. Check Event / Court Specific Assignment
  IF p_event_id IS NOT NULL THEN
    IF p_allow_court_manager THEN
      RETURN EXISTS (
        SELECT 1 FROM public.event_assignments
        WHERE event_id = p_event_id
          AND user_id = p_user_id
          AND role IN ('TABLE_OFFICIAL', 'COURT_MANAGER', 'REFEREE', 'JUDGE')
          AND (p_court_id IS NULL OR court_id IS NULL OR court_id = p_court_id)
      );
    ELSE
      RETURN EXISTS (
        SELECT 1 FROM public.event_assignments
        WHERE event_id = p_event_id
          AND user_id = p_user_id
          AND role IN ('TABLE_OFFICIAL', 'REFEREE', 'JUDGE')
          AND (p_court_id IS NULL OR court_id IS NULL OR court_id = p_court_id)
      );
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated;


-- 5. Reconcile assign_event_role
CREATE OR REPLACE FUNCTION public.assign_event_role(
  p_event_id UUID,
  p_user_id UUID,
  p_role public.event_role,
  p_court_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_tournament_id UUID;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_mgr BOOLEAN := FALSE;
  v_assignment_id UUID;
  v_requester_status TEXT;
  v_target_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '40100: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 1. Check Caller Account Status
  SELECT p.status INTO v_requester_status
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION '40300: Requester profile is not in ACTIVE standing' USING ERRCODE = '40300';
  END IF;

  -- 2. Check Target Official Account Status
  SELECT p.status INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_status IS NULL OR v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION '40300: Target user profile is not in ACTIVE standing' USING ERRCODE = '40300';
  END IF;

  -- 3. Resolve Tournament ID
  SELECT tournament_id INTO v_tournament_id
  FROM public.events
  WHERE id = p_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'P0002: Event not found' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Check Caller Authorization
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'),
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role = 'ADMIN')
  INTO v_is_super_admin, v_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.tournaments
    WHERE id = v_tournament_id AND organizer_id = v_caller_id
  ) INTO v_is_organizer;

  IF NOT (v_is_super_admin OR v_is_admin OR v_is_organizer) THEN
    -- Check if caller is COURT_MANAGER on this event
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments
      WHERE event_id = p_event_id
        AND user_id = v_caller_id
        AND role = 'COURT_MANAGER'
        AND (p_court_id IS NULL OR court_id IS NULL OR court_id = p_court_id)
    ) INTO v_is_court_mgr;

    IF NOT v_is_court_mgr THEN
      RAISE EXCEPTION '42501 FORBIDDEN: Caller is not authorized to assign officials for this event'
        USING ERRCODE = '42501';
    END IF;

    -- Court managers can only assign TABLE_OFFICIAL, REFEREE, or JUDGE
    IF p_role = 'COURT_MANAGER' THEN
      RAISE EXCEPTION '42501 FORBIDDEN: Court managers cannot assign other court managers'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 5. Upsert Assignment
  INSERT INTO public.event_assignments (
    event_id,
    user_id,
    role,
    court_id
  ) VALUES (
    p_event_id,
    p_user_id,
    p_role,
    p_court_id
  )
  ON CONFLICT (event_id, user_id, role) DO UPDATE
  SET court_id = p_court_id
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) TO authenticated;


-- 6. Reconcile generate_tournament_brackets
CREATE OR REPLACE FUNCTION public.generate_tournament_brackets(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_role TEXT;
  v_requester_status TEXT;
  v_tournament_status TEXT;
  v_event RECORD;
  v_events_processed INTEGER := 0;
  v_total_matches_generated INTEGER := 0;
  v_participants UUID[];
  v_participant_count INTEGER;
  v_rounds_needed INTEGER;
  v_bracket_size INTEGER;
  v_match_idx INTEGER;
  v_round INTEGER;
  v_matches_in_round INTEGER;
  v_created_match_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '40100: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 1. Check Caller Account Status & Role
  SELECT ur.role::text, p.status
  INTO v_role, v_requester_status
  FROM public.user_roles ur
  INNER JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = v_caller_id
    AND ur.role IN ('SUPER_ADMIN', 'ADMIN', 'TOURNAMENT_MANAGER', 'ORGANIZER')
  LIMIT 1;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE' THEN
    -- Check if tournament owner
    IF NOT EXISTS (
      SELECT 1 FROM public.tournaments t
      INNER JOIN public.profiles p ON p.id = t.organizer_id
      WHERE t.id = p_tournament_id AND t.organizer_id = v_caller_id AND p.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION '42501 FORBIDDEN: Insufficient privileges to generate tournament brackets'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify Tournament Status
  SELECT status INTO v_tournament_status
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF v_tournament_status IS NULL THEN
    RAISE EXCEPTION 'P0002 NOT_FOUND: Tournament not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament_status = 'COMPLETED' THEN
    RAISE EXCEPTION '22023 INVALID_STATE: Cannot generate brackets for completed tournament'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Loop over Full Contact events only
  FOR v_event IN
    SELECT e.id, e.name, e.category
    FROM public.events e
    WHERE e.tournament_id = p_tournament_id
      AND e.category NOT ILIKE '%ANYO%'
  LOOP
    -- Collect approved LINEUP participants
    SELECT array_agg(r.id ORDER BY r.created_at ASC)
    INTO v_participants
    FROM public.registrations r
    WHERE r.event_id = v_event.id
      AND r.is_approved = TRUE
      AND r.lineup_role = 'LINEUP';

    v_participant_count := COALESCE(array_length(v_participants, 1), 0);

    IF v_participant_count >= 2 THEN
      -- Delete existing non-completed scheduled matches for regeneration
      DELETE FROM public.matches
      WHERE event_id = v_event.id
        AND status IN ('PENDING', 'SCHEDULED')
        AND winner_registration_id IS NULL;

      -- Calculate power-of-two bracket size
      v_bracket_size := 2;
      v_rounds_needed := 1;
      WHILE v_bracket_size < v_participant_count LOOP
        v_bracket_size := v_bracket_size * 2;
        v_rounds_needed := v_rounds_needed + 1;
      END LOOP;

      -- Seed Round 1 matches
      v_matches_in_round := v_bracket_size / 2;
      FOR v_match_idx IN 1..v_matches_in_round LOOP
        INSERT INTO public.matches (
          tournament_id,
          event_id,
          bracket_node_index,
          round_name,
          round_number,
          match_number,
          red_corner_registration_id,
          blue_corner_registration_id,
          status
        ) VALUES (
          p_tournament_id,
          v_event.id,
          v_match_idx,
          CASE WHEN v_matches_in_round = 1 THEN 'Finals'
               WHEN v_matches_in_round = 2 THEN 'Semi-Finals'
               WHEN v_matches_in_round = 4 THEN 'Quarter-Finals'
               ELSE 'Round of ' || (v_matches_in_round * 2)::text
          END,
          1,
          v_match_idx,
          CASE WHEN (v_match_idx * 2 - 1) <= v_participant_count THEN v_participants[v_match_idx * 2 - 1] ELSE NULL END,
          CASE WHEN (v_match_idx * 2) <= v_participant_count THEN v_participants[v_match_idx * 2] ELSE NULL END,
          'SCHEDULED'
        );
        v_total_matches_generated := v_total_matches_generated + 1;
      END LOOP;

      v_events_processed := v_events_processed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'events_processed', v_events_processed,
    'total_matches_generated', v_total_matches_generated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tournament_brackets(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated;
