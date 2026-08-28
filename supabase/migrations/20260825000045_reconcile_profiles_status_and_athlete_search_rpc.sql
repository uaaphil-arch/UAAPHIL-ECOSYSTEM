-- =============================================================================
-- Migration: 20260825000045_reconcile_profiles_status_and_athlete_search_rpc.sql
-- Description: Reconciles search_athletes_for_coach, coach_add_player_membership,
--              coach_set_event_lineup, is_authorized_tournament_official,
--              assign_event_role, and generate_tournament_brackets with the
--              canonical public.profiles.status column contract.
-- =============================================================================

-- 1. Reconcile search_athletes_for_coach RPC
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
  v_caller_role TEXT;
  v_clean_query TEXT;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Authorize caller (COACH, SUPER_ADMIN, or ADMIN with active account status)
  SELECT ur.role::text INTO v_caller_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = v_caller_id
    AND ur.role IN ('COACH'::public.app_role, 'SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
    AND p.status = 'ACTIVE'
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient privileges to search athletes.'
      USING ERRCODE = '42501';
  END IF;

  v_clean_query := TRIM(COALESCE(p_query, ''));
  IF LENGTH(v_clean_query) < 2 THEN
    RETURN;
  END IF;

  -- 3. Return active players matching search query with club affiliation status
  RETURN QUERY
  SELECT 
    p.id AS user_id,
    COALESCE(p.full_name, 'Unnamed Athlete') AS full_name,
    CASE 
      WHEN cm.id IS NOT NULL AND cm.status = 'ACTIVE' THEN 'ACTIVE_MEMBER'
      WHEN cm.id IS NOT NULL AND cm.status = 'PENDING' THEN 'PENDING_MEMBER'
      WHEN cm.id IS NOT NULL AND cm.status = 'SUSPENDED' THEN 'SUSPENDED_MEMBER'
      ELSE 'UNATTACHED'
    END AS affiliation_status,
    c.id AS active_club_id,
    c.name AS active_club_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
  LEFT JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.status IN ('ACTIVE', 'PENDING', 'SUSPENDED')
  LEFT JOIN public.clubs c ON c.id = cm.club_id
  WHERE p.status = 'ACTIVE'
    AND p.full_name ILIKE '%' || v_clean_query || '%'
  ORDER BY p.full_name ASC
  LIMIT 30;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_athletes_for_coach(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_athletes_for_coach(TEXT) TO authenticated;


-- 2. Reconcile coach_add_player_membership RPC
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
  v_is_coach BOOLEAN := FALSE;
  v_is_super_admin BOOLEAN := FALSE;
  v_target_profile RECORD;
  v_existing_active_membership RECORD;
  v_existing_club_membership RECORD;
  v_new_membership_id UUID;
  v_club RECORD;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify Club exists and is active
  SELECT * INTO v_club
  FROM public.clubs
  WHERE id = p_club_id AND is_active = TRUE;

  IF v_club.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club % does not exist or is inactive.', p_club_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify Coach Authority for this specific club
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'::public.app_role
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    v_is_coach := public.get_coach_team_authority(v_caller_id, p_club_id);
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for club %.', p_club_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Verify Target User is an active PLAYER (canonical p.status = 'ACTIVE')
  SELECT p.* INTO v_target_profile
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
  WHERE p.id = p_player_user_id
    AND p.status = 'ACTIVE';

  IF v_target_profile.id IS NULL THEN
    RAISE EXCEPTION 'INELIGIBLE_ATHLETE: Target user does not hold an active PLAYER account.'
      USING ERRCODE = '42200';
  END IF;

  -- 5. Enforce Global Single Active Membership Invariant
  SELECT * INTO v_existing_active_membership
  FROM public.club_memberships
  WHERE player_user_id = p_player_user_id
    AND status = 'ACTIVE'
  LIMIT 1;

  IF v_existing_active_membership.id IS NOT NULL THEN
    IF v_existing_active_membership.club_id = p_club_id THEN
      RETURN jsonb_build_object(
        'success', TRUE,
        'membership_id', v_existing_active_membership.id,
        'status', 'ACTIVE',
        'message', 'Athlete is already an active member of this club.'
      );
    ELSE
      RAISE EXCEPTION 'ALREADY_ACTIVE_MEMBER: Player already belongs to an active club. Must be relieved or transferred first.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 6. Check for existing pending/relieved/rejected membership in target club
  SELECT * INTO v_existing_club_membership
  FROM public.club_memberships
  WHERE player_user_id = p_player_user_id
    AND club_id = p_club_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_club_membership.id IS NOT NULL AND v_existing_club_membership.status IN ('PENDING', 'SUSPENDED', 'RELIEVED', 'REJECTED') THEN
    UPDATE public.club_memberships
    SET status = 'ACTIVE',
        membership_type = COALESCE(p_membership_type, membership_type),
        effective_from = timezone('utc'::text, now()),
        effective_to = NULL,
        approved_by = v_caller_id,
        reviewed_at = timezone('utc'::text, now()),
        review_notes = COALESCE(review_notes, '') || E'\n[ACTIVATED BY COACH ' || timezone('utc'::text, now()) || ']: ' || COALESCE(p_notes, 'Direct onboarding'),
        updated_at = timezone('utc'::text, now())
    WHERE id = v_existing_club_membership.id
    RETURNING id INTO v_new_membership_id;
  ELSE
    INSERT INTO public.club_memberships (
      player_user_id,
      club_id,
      status,
      membership_type,
      effective_from,
      effective_to,
      requested_by,
      approved_by,
      reviewed_at,
      review_notes,
      created_at,
      updated_at
    ) VALUES (
      p_player_user_id,
      p_club_id,
      'ACTIVE',
      COALESCE(p_membership_type, 'REGULAR'),
      timezone('utc'::text, now()),
      NULL,
      v_caller_id,
      v_caller_id,
      timezone('utc'::text, now()),
      COALESCE(p_notes, 'Direct onboarding by coach'),
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    )
    RETURNING id INTO v_new_membership_id;
  END IF;

  -- 7. Record System Audit Log
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
    v_caller_id,
    CASE WHEN v_is_super_admin THEN 'SUPER_ADMIN' ELSE 'COACH' END,
    'COACH_ADD_PLAYER_MEMBERSHIP',
    'club_memberships',
    v_new_membership_id,
    NULL,
    jsonb_build_object(
      'club_id', p_club_id,
      'player_user_id', p_player_user_id,
      'membership_type', p_membership_type,
      'notes', p_notes
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'membership_id', v_new_membership_id,
    'status', 'ACTIVE',
    'message', 'Athlete successfully added to active club roster.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.coach_add_player_membership(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_add_player_membership(UUID, UUID, TEXT, TEXT) TO authenticated;


-- 3. Reconcile coach_set_event_lineup RPC
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
  v_is_coach BOOLEAN := FALSE;
  v_is_super_admin BOOLEAN := FALSE;
  v_tournament RECORD;
  v_club RECORD;
  v_uid UUID;
  v_ineligible_uid UUID;
  v_lineup_count INT := 0;
  v_reserve_count INT := 0;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify Club exists and is active
  SELECT * INTO v_club
  FROM public.clubs
  WHERE id = p_club_id AND is_active = TRUE;

  IF v_club.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club % not found or inactive.', p_club_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify Coach Authority
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'::public.app_role
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    v_is_coach := public.get_coach_team_authority(v_caller_id, p_club_id);
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for club %.', p_club_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Lock and Validate Tournament Lifecycle State
  SELECT t.* INTO v_tournament
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id
  FOR UPDATE OF t;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event or associated tournament not found for event %.', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Lineups cannot be modified when tournament status is %. Tournament is locked.', v_tournament.status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Disjoint Check (Athlete cannot be both LINEUP and RESERVE in same event)
  IF p_lineup_user_ids IS NOT NULL AND p_reserve_user_ids IS NOT NULL THEN
    SELECT unnest(p_lineup_user_ids) INTERSECT SELECT unnest(p_reserve_user_ids) LIMIT 1 INTO v_uid;
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Athlete % cannot be designated as both LINEUP and RESERVE.', v_uid
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Validate Eligibility for LINEUP athletes (Active member of club, active profile, PLAYER role)
  IF p_lineup_user_ids IS NOT NULL AND array_length(p_lineup_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND p.status = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: User % is not an active PLAYER member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- 7. Validate Eligibility for RESERVE athletes
  IF p_reserve_user_ids IS NOT NULL AND array_length(p_reserve_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND p.status = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: Reserve user % is not an active PLAYER member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- 8. Apply Lineup & Reserve Assignments Atomically
  -- Mark removed club athletes for this event as WITHDRAWN
  UPDATE public.registrations
  SET lineup_role = 'WITHDRAWN',
      updated_at = timezone('utc'::text, now())
  WHERE event_id = p_event_id
    AND club_id = p_club_id
    AND user_id != ALL(COALESCE(p_lineup_user_ids, ARRAY[]::UUID[]) || COALESCE(p_reserve_user_ids, ARRAY[]::UUID[]))
    AND lineup_role != 'WITHDRAWN';

  -- Upsert LINEUP athletes
  IF p_lineup_user_ids IS NOT NULL AND array_length(p_lineup_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        approved_by,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'LINEUP',
        FALSE, -- Invariant: New Coach submissions default to unapproved (pending review)
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'LINEUP',
          -- Invariant: Preserve existing is_approved and approved_by; never force TRUE
          is_approved = public.registrations.is_approved,
          approved_by = public.registrations.approved_by,
          updated_at = timezone('utc'::text, now());
          
      v_lineup_count := v_lineup_count + 1;
    END LOOP;
  END IF;

  -- Upsert RESERVE athletes
  IF p_reserve_user_ids IS NOT NULL AND array_length(p_reserve_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        approved_by,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'RESERVE',
        FALSE, -- Invariant: New Coach submissions default to unapproved (pending review)
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'RESERVE',
          -- Invariant: Preserve existing is_approved and approved_by; never force TRUE
          is_approved = public.registrations.is_approved,
          approved_by = public.registrations.approved_by,
          updated_at = timezone('utc'::text, now());

      v_reserve_count := v_reserve_count + 1;
    END LOOP;
  END IF;

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
    v_caller_id,
    CASE WHEN v_is_super_admin THEN 'SUPER_ADMIN' ELSE 'COACH' END,
    'COACH_SET_EVENT_LINEUP',
    'EVENT',
    p_event_id,
    v_tournament.id,
    jsonb_build_object(
      'club_id', p_club_id,
      'club_name', v_club.name,
      'event_id', p_event_id,
      'lineup_count', v_lineup_count,
      'reserve_count', v_reserve_count,
      'lineup_user_ids', p_lineup_user_ids,
      'reserve_user_ids', p_reserve_user_ids
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'club_id', p_club_id,
    'lineup_count', v_lineup_count,
    'reserve_count', v_reserve_count,
    'tournament_status', v_tournament.status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) TO authenticated;


-- 4. Reconcile is_authorized_tournament_official Function
CREATE OR REPLACE FUNCTION public.is_authorized_tournament_official(
  p_user_id UUID,
  p_tournament_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_court_id UUID DEFAULT NULL,
  p_allow_court_manager BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
  v_is_table_official BOOLEAN := FALSE;
  v_user_status TEXT;
  v_resolved_tournament_id UUID;
  v_organizer_id UUID;
BEGIN
  -- 1. Validate Input
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2. Check User Account Status (canonical status TEXT)
  SELECT p.status
  INTO v_user_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_user_status IS NULL OR v_user_status <> 'ACTIVE' THEN
    RETURN FALSE;
  END IF;

  -- 3. Check Permanent Super Admin / Admin Privileges
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF v_is_super_admin OR v_is_admin THEN
    RETURN TRUE;
  END IF;

  -- 4. Check Tournament Ownership / Organizer Privileges
  IF p_event_id IS NOT NULL THEN
    SELECT ts.tournament_id, t.organizer_id
    INTO v_resolved_tournament_id, v_organizer_id
    FROM public.events e
    JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
    JOIN public.tournaments t ON t.id = ts.tournament_id
    WHERE e.id = p_event_id;
  ELSIF p_tournament_id IS NOT NULL THEN
    SELECT t.id, t.organizer_id
    INTO v_resolved_tournament_id, v_organizer_id
    FROM public.tournaments t
    WHERE t.id = p_tournament_id;
  END IF;

  -- If user is the tournament organizer who owns this tournament
  IF v_organizer_id IS NOT NULL AND v_organizer_id = p_user_id THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = p_user_id AND ur.role IN ('ORGANIZER'::public.app_role, 'ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role)
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 5. Check Event-Wide COURT_MANAGER (Dispatch/Queue Operations)
  IF p_event_id IS NOT NULL AND p_allow_court_manager = TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.user_id = p_user_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.court_id IS NULL
        AND ea.is_active = TRUE
    ) INTO v_is_court_manager;

    IF v_is_court_manager THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 6. Check Court-Scoped TABLE_OFFICIAL (Match Control & Scoring)
  IF p_event_id IS NOT NULL AND p_court_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.court_id = p_court_id
        AND ea.user_id = p_user_id
        AND ea.role = 'TABLE_OFFICIAL'::public.event_role
        AND ea.is_active = TRUE
    ) INTO v_is_table_official;

    IF v_is_table_official THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- Default Deny
  RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated;


-- 5. Reconcile assign_event_role RPC
CREATE OR REPLACE FUNCTION public.assign_event_role(
  p_event_id UUID,
  p_user_id UUID,
  p_role public.event_role,
  p_court_id UUID DEFAULT NULL
)
RETURNS public.event_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_status TEXT;
  v_target_status TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
  v_resolved_tournament_id UUID;
  v_organizer_id UUID;
  v_court_tournament_id UUID;
  v_existing_id UUID;
  v_assignment public.event_assignments;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Check Requester Status
  SELECT p.status
  INTO v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester account is not active.' USING ERRCODE = '40300';
  END IF;

  -- 3. Check Target User Status
  SELECT p.status
  INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_status IS NULL OR v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Target official account is not active.' USING ERRCODE = '40001';
  END IF;

  -- 4. Check Target Official Qualifications
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role, 'ORGANIZER'::public.app_role, 'COURT_MANAGER'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Target user does not hold a qualifying official system role.' USING ERRCODE = '40300';
  END IF;

  -- 5. Resolve Tournament and Event Ownership
  SELECT ts.tournament_id, t.organizer_id
  INTO v_resolved_tournament_id, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_resolved_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event does not exist or has no valid tournament.' USING ERRCODE = '40400';
  END IF;

  -- 6. Validate Role-Specific Court Constraints
  IF p_role = 'COURT_MANAGER'::public.event_role THEN
    IF p_court_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: COURT_MANAGER must be assigned event-wide with court_id = NULL.' USING ERRCODE = '40002';
    END IF;
  ELSIF p_role = 'TABLE_OFFICIAL'::public.event_role THEN
    IF p_court_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: TABLE_OFFICIAL must be assigned to a specific court_id.' USING ERRCODE = '40003';
    END IF;

    SELECT c.tournament_id
    INTO v_court_tournament_id
    FROM public.courts c
    WHERE c.id = p_court_id;

    IF v_court_tournament_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: Designated court does not exist.' USING ERRCODE = '40401';
    END IF;

    IF v_court_tournament_id <> v_resolved_tournament_id THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: Court belongs to a different tournament.' USING ERRCODE = '40301';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_ROLE: Unsupported operational role %', p_role USING ERRCODE = '40006';
  END IF;

  -- 7. Verify Requester Authority
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF NOT (v_is_super_admin OR v_is_admin) THEN
    -- If organizer
    IF v_organizer_id = v_requester_id AND EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ORGANIZER'::public.app_role
    ) THEN
      v_is_organizer := TRUE;
    END IF;

    -- If event Court Manager
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.user_id = v_requester_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.court_id IS NULL
        AND ea.is_active = TRUE
    ) INTO v_is_court_manager;

    IF v_is_organizer THEN
      NULL;
    ELSIF v_is_court_manager THEN
      -- Court Manager can only assign Table Officials
      IF p_role <> 'TABLE_OFFICIAL'::public.event_role THEN
        RAISE EXCEPTION 'FORBIDDEN: Court Managers can only assign Table Officials.' USING ERRCODE = '40300';
      END IF;
    ELSE
      RAISE EXCEPTION 'FORBIDDEN: Insufficient privileges to assign event official roles.' USING ERRCODE = '40300';
    END IF;
  END IF;

  -- 8. Single Active COURT_MANAGER Invariant
  IF p_role = 'COURT_MANAGER'::public.event_role THEN
    UPDATE public.event_assignments
    SET is_active = FALSE,
        revoked_at = NOW(),
        revoked_by = v_requester_id
    WHERE event_id = p_event_id
      AND role = 'COURT_MANAGER'::public.event_role
      AND is_active = TRUE
      AND user_id <> p_user_id;
  END IF;

  -- 9. Safe Look-up / Reactivation or Insertion (No invalid ON CONFLICT targets)
  SELECT id INTO v_existing_id
  FROM public.event_assignments
  WHERE event_id = p_event_id
    AND user_id = p_user_id
    AND role = p_role
    AND ((court_id IS NULL AND p_court_id IS NULL) OR (court_id = p_court_id))
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_assignments
    SET is_active = TRUE,
        assigned_by = v_requester_id,
        revoked_at = NULL,
        revoked_by = NULL
    WHERE id = v_existing_id
    RETURNING * INTO v_assignment;
  ELSE
    INSERT INTO public.event_assignments (
      event_id,
      user_id,
      role,
      court_id,
      is_active,
      assigned_by,
      created_at
    ) VALUES (
      p_event_id,
      p_user_id,
      p_role,
      p_court_id,
      TRUE,
      v_requester_id,
      NOW()
    )
    RETURNING * INTO v_assignment;
  END IF;

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
    'ADMIN',
    'ASSIGN_EVENT_ROLE',
    'EVENT_ASSIGNMENT',
    v_assignment.id,
    v_resolved_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'target_user_id', p_user_id,
      'role', p_role,
      'court_id', p_court_id
    ),
    NOW()
  );

  RETURN v_assignment;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) TO authenticated;


-- 6. Reconcile generate_tournament_brackets RPC
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
  v_requester_status TEXT;
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
  v_leaf_start_node INT;
  v_leaf_end_node INT;
  v_leaf_count INT;
  v_pair_idx INT;
  v_total_matches_generated INT := 0;
  v_events_processed INT := 0;
  v_active_matches_count INT := 0;
  v_p_red RECORD;
  v_p_blue RECORD;
  v_pair_p1 JSONB;
  v_pair_p2 JSONB;
BEGIN
  -- 1. Authenticate and verify admin privileges (canonical p.status = 'ACTIVE')
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT ur.role::text, p.status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN or ADMIN can generate tournament brackets' USING ERRCODE = '40300';
  END IF;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active' USING ERRCODE = '40300';
  END IF;

  -- 2. Validate Tournament State
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id;

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

    -- Extract approved registrations belonging to this event
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
      AND r.is_approved = TRUE;

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

REVOKE EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated;
