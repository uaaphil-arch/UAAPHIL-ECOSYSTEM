-- =============================================================================
-- Migration: 20260826000049_fix_athlete_search_and_lineup_player_role_cast.sql
-- Description: Forward-only remediation removing invalid 'PLAYER'::public.app_role
--              cast from search_athletes_for_coach, coach_add_player_membership,
--              and coach_set_event_lineup.
-- Architectural Note:
--   The canonical public.app_role enum contains only elevated system roles:
--   ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH').
--   Athletes/players are represented through normal active user accounts in
--   public.profiles (p.status = 'ACTIVE') and valid club membership domain records
--   in public.club_memberships, rather than entries in public.user_roles.
-- Phase: 25E
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

  -- 3. Return active users matching search query with club affiliation status
  -- Note: Athletes are active profiles in public.profiles. No administrative app_role required.
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

  -- 4. Verify Target User is an active profile (canonical p.status = 'ACTIVE')
  -- Note: Athletes are active profiles in public.profiles. No administrative app_role required.
  SELECT p.* INTO v_target_profile
  FROM public.profiles p
  WHERE p.id = p_player_user_id
    AND p.status = 'ACTIVE';

  IF v_target_profile.id IS NULL THEN
    RAISE EXCEPTION 'INELIGIBLE_ATHLETE: Target user does not hold an active account.'
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

  -- 6. Validate Eligibility for LINEUP athletes (Active member of club and active profile)
  -- Note: Athletes are active profiles in public.profiles attached to active club memberships.
  IF p_lineup_user_ids IS NOT NULL AND array_length(p_lineup_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND p.status = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: User % is not an active member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- 7. Validate Eligibility for RESERVE athletes (Active member of club and active profile)
  IF p_reserve_user_ids IS NOT NULL AND array_length(p_reserve_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND p.status = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: Reserve user % is not an active member of club %.', v_uid, p_club_id
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
