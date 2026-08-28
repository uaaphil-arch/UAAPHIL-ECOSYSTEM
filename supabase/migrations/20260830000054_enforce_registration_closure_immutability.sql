-- ==============================================================================
-- Migration: 20260830000054_enforce_registration_closure_immutability.sql
-- Description: Phase 33 — Remediates BUG-33-01 by enforcing strict server-side
--              registration and lineup immutability upon REGISTRATION_CLOSED.
--
-- Authoritative Business Rules:
--   1. LINEUP and RESERVE participant assignments are mutable ONLY while tournament
--      status is exactly 'REGISTRATION_OPEN'.
--   2. When tournament reaches 'REGISTRATION_CLOSED', ONGOING, COMPLETED, CANCELLED,
--      or ARCHIVED, participant rosters, lineup roles, swaps, insertions, and
--      deletions are 100% immutable at the database engine level.
--   3. Functions Reconciled:
--      - public.swap_event_lineup_reserve (blocks when status != 'REGISTRATION_OPEN')
--      - public.coach_set_event_lineup (blocks when status != 'REGISTRATION_OPEN')
--      - public.enforce_registration_immutability (trigger prevents INSERT/DELETE
--        and role/identity mutation on REGISTRATION_CLOSED)
-- ==============================================================================

-- --------------------------------------------------------------------
-- 1. RPC: swap_event_lineup_reserve
-- Reconciled to strictly require tournament status = 'REGISTRATION_OPEN'
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

  -- 3. Lock Tournament Row and verify lifecycle stage (Strictly REGISTRATION_OPEN)
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

  IF v_tournament.status != 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'INVALID_STATE: Lineup substitutions are locked because tournament status is % (Required: REGISTRATION_OPEN).', v_tournament.status
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
-- 2. RPC: coach_set_event_lineup
-- Reconciled to strictly require tournament status = 'REGISTRATION_OPEN'
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

  -- 4. Lock and Validate Tournament Lifecycle State (Strictly REGISTRATION_OPEN)
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

  IF v_tournament.status != 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'INVALID_STATE: Lineups cannot be modified when tournament status is % (Required: REGISTRATION_OPEN). Tournament is locked.', v_tournament.status
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
        FALSE,
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'LINEUP',
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
        FALSE,
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'RESERVE',
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

-- --------------------------------------------------------------------
-- 3. TRIGGER & FUNCTION: enforce_registration_immutability
-- Reconciled to block all INSERT, DELETE, and lineup_role / identity
-- mutations on REGISTRATION_CLOSED, ONGOING, COMPLETED, CANCELLED, ARCHIVED.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_registration_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tournament_status TEXT;
  v_target_event_id UUID;
BEGIN
  v_target_event_id := COALESCE(OLD.event_id, NEW.event_id);

  SELECT t.status INTO v_tournament_status
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_target_event_id;

  -- 1. Complete freeze for ONGOING, COMPLETED, CANCELLED, ARCHIVED tournaments
  IF v_tournament_status IN ('ONGOING', 'COMPLETED', 'CANCELLED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'FORBIDDEN: Registrations are locked and immutable when tournament status is %', v_tournament_status
      USING ERRCODE = '42501';
  END IF;

  -- 2. Registration Closure Immutability: Block all additions, deletions, roster changes, or role swaps
  IF v_tournament_status = 'REGISTRATION_CLOSED' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'FORBIDDEN: New registrations cannot be created when tournament status is REGISTRATION_CLOSED.'
        USING ERRCODE = '42501';
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'FORBIDDEN: Registrations cannot be deleted when tournament status is REGISTRATION_CLOSED.'
        USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' THEN
      -- Strict participant roster immutability
      IF NEW.lineup_role IS DISTINCT FROM OLD.lineup_role THEN
        RAISE EXCEPTION 'FORBIDDEN: Lineup roles are locked and immutable when tournament status is REGISTRATION_CLOSED.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'FORBIDDEN: user_id is immutable when tournament status is REGISTRATION_CLOSED.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
        RAISE EXCEPTION 'FORBIDDEN: event_id is immutable when tournament status is REGISTRATION_CLOSED.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.club_id IS DISTINCT FROM OLD.club_id THEN
        RAISE EXCEPTION 'FORBIDDEN: club_id is immutable when tournament status is REGISTRATION_CLOSED.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 3. Maintain existing event_id and user_id immutability for non-superadmins during registration phases
  IF TG_OP = 'UPDATE' THEN
    IF NOT public.is_super_admin(auth.uid()) THEN
      IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
        RAISE EXCEPTION 'event_id is immutable for athlete registrations.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'user_id is immutable for athlete registrations.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_registration_immutability_trigger ON public.registrations;
CREATE TRIGGER enforce_registration_immutability_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_immutability();
