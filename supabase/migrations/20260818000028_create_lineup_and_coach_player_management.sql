-- ====================================================================
-- MIGRATION: 20260818000028_create_lineup_and_coach_player_management.sql
-- DESCRIPTION: Phase 10.7-C: Coach Player Discovery, Membership Suspension/Restoration,
--              Tournament Event Lineup/Reserve Management, and Atomic Substitution Engine.
-- DOMAIN: UAAPHIL Tournament System
-- TARGET: PostgreSQL 15+ / Supabase
-- INVARIANTS:
--   1. Additive non-destructive extension of public.registrations.
--   2. Historical registrations safely default to lineup_role = 'LINEUP'.
--   3. Strict Coach RBAC isolation via public.get_coach_team_authority.
--   4. Tournament lifecycle immutability (lineup mutations locked in ONGOING).
--   5. Deterministic bracket seeding incorporates LINEUP approved athletes only.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. ADDITIVE COLUMNS & CONSTRAINTS ON PUBLIC.REGISTRATIONS
-- --------------------------------------------------------------------

DO $$
BEGIN
  -- Add lineup_role column with CHECK constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'lineup_role'
  ) THEN
    ALTER TABLE public.registrations
      ADD COLUMN lineup_role TEXT NOT NULL DEFAULT 'LINEUP'
      CHECK (lineup_role IN ('LINEUP', 'RESERVE', 'WITHDRAWN'));
  END IF;

  -- Add club_id FK column referencing public.clubs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'club_id'
  ) THEN
    ALTER TABLE public.registrations
      ADD COLUMN club_id UUID REFERENCES public.clubs(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Performance & Query Indexes for Lineup Management
CREATE INDEX IF NOT EXISTS idx_registrations_event_club_lineup
  ON public.registrations(event_id, club_id, lineup_role);

CREATE INDEX IF NOT EXISTS idx_registrations_lineup_role
  ON public.registrations(lineup_role);

CREATE INDEX IF NOT EXISTS idx_registrations_club_id
  ON public.registrations(club_id);

-- --------------------------------------------------------------------
-- 2. RPC: search_athletes_for_coach
-- Safe athlete search returning only active PLAYER accounts without PII leakage.
-- --------------------------------------------------------------------
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

  -- 2. Authorize caller (COACH, SUPER_ADMIN, or ADMIN with active account)
  SELECT ur.role::text INTO v_caller_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = v_caller_id
    AND ur.role IN ('COACH'::public.app_role, 'SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
    AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE'
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
  WHERE COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE'
    AND p.full_name ILIKE '%' || v_clean_query || '%'
  ORDER BY p.full_name ASC
  LIMIT 30;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_athletes_for_coach(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_athletes_for_coach(TEXT) TO authenticated;

-- --------------------------------------------------------------------
-- 3. RPC: coach_add_player_membership
-- Allows an authorized Coach to add an eligible athlete to their club roster.
-- --------------------------------------------------------------------
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

  -- 4. Verify Target User is an active PLAYER
  SELECT p.* INTO v_target_profile
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
  WHERE p.id = p_player_user_id
    AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE';

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

-- --------------------------------------------------------------------
-- 4. RPC: suspend_player_membership
-- Places an active club player on suspension.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suspend_player_membership(
  p_membership_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_membership RECORD;
  v_is_coach BOOLEAN := FALSE;
  v_is_super_admin BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_membership
  FROM public.club_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club membership % not found.', p_membership_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_membership.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only ACTIVE memberships can be suspended. Current status: %', v_membership.status
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'::public.app_role
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    v_is_coach := public.get_coach_team_authority(v_caller_id, v_membership.club_id);
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for this club.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.club_memberships
  SET status = 'SUSPENDED',
      reviewed_at = timezone('utc'::text, now()),
      review_notes = COALESCE(review_notes, '') || E'\n[SUSPENDED ' || timezone('utc'::text, now()) || ']: ' || COALESCE(p_reason, 'Suspended by coach'),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_membership_id;

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
    'SUSPEND_PLAYER_MEMBERSHIP',
    'club_memberships',
    p_membership_id,
    NULL,
    jsonb_build_object(
      'club_id', v_membership.club_id,
      'player_user_id', v_membership.player_user_id,
      'reason', p_reason
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'membership_id', p_membership_id,
    'status', 'SUSPENDED',
    'message', 'Player membership suspended.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suspend_player_membership(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspend_player_membership(UUID, TEXT) TO authenticated;

-- --------------------------------------------------------------------
-- 5. RPC: restore_player_membership
-- Restores a suspended player back to ACTIVE status.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_player_membership(
  p_membership_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_membership RECORD;
  v_is_coach BOOLEAN := FALSE;
  v_is_super_admin BOOLEAN := FALSE;
  v_conflict_active UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_membership
  FROM public.club_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club membership % not found.', p_membership_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_membership.status != 'SUSPENDED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only SUSPENDED memberships can be restored. Current status: %', v_membership.status
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'::public.app_role
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    v_is_coach := public.get_coach_team_authority(v_caller_id, v_membership.club_id);
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for this club.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Ensure no other active membership exists
  SELECT id INTO v_conflict_active
  FROM public.club_memberships
  WHERE player_user_id = v_membership.player_user_id
    AND status = 'ACTIVE'
    AND id != p_membership_id
  LIMIT 1;

  IF v_conflict_active IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: Player has acquired another active membership (%).', v_conflict_active
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.club_memberships
  SET status = 'ACTIVE',
      reviewed_at = timezone('utc'::text, now()),
      review_notes = COALESCE(review_notes, '') || E'\n[RESTORED ' || timezone('utc'::text, now()) || ']: ' || COALESCE(p_notes, 'Restored by coach'),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_membership_id;

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
    'RESTORE_PLAYER_MEMBERSHIP',
    'club_memberships',
    p_membership_id,
    NULL,
    jsonb_build_object(
      'club_id', v_membership.club_id,
      'player_user_id', v_membership.player_user_id,
      'notes', p_notes
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'membership_id', p_membership_id,
    'status', 'ACTIVE',
    'message', 'Player membership restored to ACTIVE status.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_player_membership(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_player_membership(UUID, TEXT) TO authenticated;

-- --------------------------------------------------------------------
-- 6. RPC: coach_set_event_lineup
-- Atomically designates starting LINEUP vs standby RESERVE athletes for an event.
-- --------------------------------------------------------------------
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

  -- 2. Verify Club exists
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
      WHERE p.id = v_uid AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE';

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
      WHERE p.id = v_uid AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE';

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
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'LINEUP',
        TRUE,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'LINEUP',
          is_approved = TRUE,
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
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'RESERVE',
        TRUE,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'RESERVE',
          is_approved = TRUE,
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
    'events',
    p_event_id,
    v_tournament.id,
    jsonb_build_object(
      'event_id', p_event_id,
      'club_id', p_club_id,
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
    'message', format('Lineup saved: %s Starting Lineup, %s Reserves.', v_lineup_count, v_reserve_count)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_set_event_lineup(UUID, UUID, UUID[], UUID[]) TO authenticated;

-- --------------------------------------------------------------------
-- 7. RPC: swap_event_lineup_reserve
-- Atomically swaps one LINEUP player with one RESERVE player before tournament lock.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.swap_event_lineup_reserve(
  p_event_id UUID,
  p_club_id UUID,
  p_lineup_reg_id UUID,
  p_reserve_reg_id UUID
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
  v_lineup_reg RECORD;
  v_reserve_reg RECORD;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify Coach Authority
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

  -- 3. Lock Tournament Row and verify lifecycle stage
  SELECT t.* INTO v_tournament
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id
  FOR UPDATE OF t;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event % or associated tournament not found.', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Lineup substitutions are locked because tournament is %.', v_tournament.status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Lock Both Registration Rows FOR UPDATE
  SELECT * INTO v_lineup_reg
  FROM public.registrations
  WHERE id = p_lineup_reg_id AND event_id = p_event_id AND club_id = p_club_id
  FOR UPDATE;

  SELECT * INTO v_reserve_reg
  FROM public.registrations
  WHERE id = p_reserve_reg_id AND event_id = p_event_id AND club_id = p_club_id
  FOR UPDATE;

  IF v_lineup_reg.id IS NULL OR v_reserve_reg.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: One or both registrations not found for this event and club.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_lineup_reg.lineup_role != 'LINEUP' THEN
    RAISE EXCEPTION 'INVALID_STATE: Registration % is not currently designated as LINEUP (Current: %).', p_lineup_reg_id, v_lineup_reg.lineup_role
      USING ERRCODE = '22000';
  END IF;

  IF v_reserve_reg.lineup_role != 'RESERVE' THEN
    RAISE EXCEPTION 'INVALID_STATE: Registration % is not currently designated as RESERVE (Current: %).', p_reserve_reg_id, v_reserve_reg.lineup_role
      USING ERRCODE = '22000';
  END IF;

  -- 5. Atomically Swap Roles
  UPDATE public.registrations
  SET lineup_role = 'RESERVE',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_lineup_reg_id;

  UPDATE public.registrations
  SET lineup_role = 'LINEUP',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_reserve_reg_id;

  -- 6. Record Audit Log
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
    'LINEUP_RESERVE_SWAPPED',
    'events',
    p_event_id,
    v_tournament.id,
    jsonb_build_object(
      'event_id', p_event_id,
      'club_id', p_club_id,
      'promoted_to_lineup_user_id', v_reserve_reg.user_id,
      'demoted_to_reserve_user_id', v_lineup_reg.user_id,
      'promoted_reg_id', p_reserve_reg_id,
      'demoted_reg_id', p_lineup_reg_id
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'club_id', p_club_id,
    'promoted_reg_id', p_reserve_reg_id,
    'demoted_reg_id', p_lineup_reg_id,
    'message', 'Lineup player and Reserve player successfully swapped.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_event_lineup_reserve(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_event_lineup_reserve(UUID, UUID, UUID, UUID) TO authenticated;

-- --------------------------------------------------------------------
-- 8. RECONCILE public.generate_tournament_brackets
-- Incorporates filter: is_approved = TRUE AND COALESCE(lineup_role, 'LINEUP') = 'LINEUP'.
-- --------------------------------------------------------------------
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
  
  v_node_map JSONB := '{}'::jsonb;
BEGIN
  -- 1. Authentication & Role Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT ur.role::text, COALESCE(p.account_status, p.status, 'ACTIVE')
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
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

  -- Purge existing SCHEDULED matches for this tournament
  DELETE FROM public.matches
  WHERE tournament_id = p_tournament_id;

  -- 5. Process Each Event: STRICTLY filter approved LINEUP participants
  FOR v_event IN SELECT * FROM jsonb_to_recordset(v_events_json) AS x(
    id UUID, name TEXT, gender TEXT, division TEXT, category TEXT, weight_class TEXT
  )
  LOOP
    v_event_id := v_event.id;
    v_node_map := '{}'::jsonb;

    -- Extract approved LINEUP registrations only (RESERVE and WITHDRAWN excluded)
    SELECT COALESCE(jsonb_agg(elem ORDER BY 
      COALESCE((elem->>'seed')::int, 999999),
      (elem->>'created_at') ASC,
      (elem->>'id') ASC
    ), '[]'::jsonb)
    INTO v_participants
    FROM jsonb_array_elements(v_registrations_json) elem
    WHERE (elem->>'event_id')::uuid = v_event_id
      AND (elem->>'is_approved')::boolean = TRUE
      AND COALESCE(elem->>'lineup_role', 'LINEUP') = 'LINEUP';

    v_participant_count := jsonb_array_length(v_participants);

    -- Only generate brackets for events with at least 2 participants
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

      -- Pre-insert empty match nodes for all rounds (Finals down to Round 1)
      FOR v_node_idx IN 1..v_total_nodes LOOP
        INSERT INTO public.matches (
          tournament_id,
          event_id,
          bracket_node_index,
          status,
          created_at
        ) VALUES (
          p_tournament_id,
          v_event_id,
          v_node_idx,
          'SCHEDULED',
          NOW()
        )
        RETURNING id INTO v_match_id;

        v_node_map := jsonb_set(v_node_map, ARRAY[v_node_idx::text], to_jsonb(v_match_id::text));
        v_total_matches_generated := v_total_matches_generated + 1;
      END LOOP;

      -- Wire Parent Pointers for bracket tree progression
      FOR v_node_idx IN 2..v_total_nodes LOOP
        v_parent_node_idx := v_node_idx / 2;
        v_parent_match_id := (v_node_map->>(v_parent_node_idx::text))::uuid;
        v_parent_corner := CASE WHEN (v_node_idx % 2 = 0) THEN 'RED' ELSE 'BLUE' END;

        UPDATE public.matches
        SET next_match_id = v_parent_match_id,
            next_match_corner = v_parent_corner
        WHERE id = (v_node_map->>(v_node_idx::text))::uuid;
      END LOOP;

      -- Seed Round 1 Leaf Nodes with Approved LINEUP Athletes
      FOR v_m IN 1..(v_bracket_size / 2) LOOP
        v_node_idx := (v_bracket_size / 2) + v_m - 1;
        v_match_id := (v_node_map->>(v_node_idx::text))::uuid;

        v_p1_idx := (v_m - 1) * 2;
        v_p2_idx := v_p1_idx + 1;

        v_p1_reg_id := CASE WHEN v_p1_idx < v_participant_count THEN (v_participants->v_p1_idx->>'id')::uuid ELSE NULL END;
        v_p2_reg_id := CASE WHEN v_p2_idx < v_participant_count THEN (v_participants->v_p2_idx->>'id')::uuid ELSE NULL END;

        v_is_bye := (v_p1_reg_id IS NOT NULL AND v_p2_reg_id IS NULL) OR (v_p1_reg_id IS NULL AND v_p2_reg_id IS NOT NULL);
        v_winner_id := CASE WHEN v_p1_reg_id IS NOT NULL AND v_p2_reg_id IS NULL THEN v_p1_reg_id
                            WHEN v_p2_reg_id IS NOT NULL AND v_p1_reg_id IS NULL THEN v_p2_reg_id
                            ELSE NULL END;

        IF v_is_bye THEN
          UPDATE public.matches
          SET red_corner_registration_id = v_p1_reg_id,
              blue_corner_registration_id = v_p2_reg_id,
              winner_registration_id = v_winner_id,
              status = 'COMPLETED',
              court_identifier = 'BYE'
          WHERE id = v_match_id;

          v_total_byes_generated := v_total_byes_generated + 1;

          -- Advance BYE winner to parent node
          IF v_node_idx > 1 THEN
            v_parent_node_idx := v_node_idx / 2;
            v_parent_match_id := (v_node_map->>(v_parent_node_idx::text))::uuid;
            v_parent_corner := CASE WHEN (v_node_idx % 2 = 0) THEN 'RED' ELSE 'BLUE' END;

            IF v_parent_corner = 'RED' THEN
              UPDATE public.matches SET red_corner_registration_id = v_winner_id WHERE id = v_parent_match_id;
            ELSE
              UPDATE public.matches SET blue_corner_registration_id = v_winner_id WHERE id = v_parent_match_id;
            END IF;
          END IF;
        ELSE
          UPDATE public.matches
          SET red_corner_registration_id = v_p1_reg_id,
              blue_corner_registration_id = v_p2_reg_id
          WHERE id = v_match_id;
        END IF;
      END LOOP;

      v_total_events_processed := v_total_events_processed + 1;
    END IF;
  END LOOP;

  -- 6. Record System Audit Log
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
      'events_processed', v_total_events_processed,
      'matches_generated', v_total_matches_generated,
      'byes_generated', v_total_byes_generated
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'events_processed', v_total_events_processed,
    'matches_generated', v_total_matches_generated,
    'byes_generated', v_total_byes_generated
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated;
