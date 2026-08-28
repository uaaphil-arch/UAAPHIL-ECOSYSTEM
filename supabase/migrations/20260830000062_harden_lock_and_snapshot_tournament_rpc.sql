-- ====================================================================
-- Migration: 20260830000062_harden_lock_and_snapshot_tournament_rpc.sql
-- Patch ID: P23-17-IMPL
-- Description: Canonical RPC Reconciliation & Persistence Hardening for public.lock_and_snapshot_tournament
-- Target Domain: UAAPHIL Tournament System — Lifecycle & Snapshot Engine
-- Sequence: 000062 (Additive, Non-destructive, Preserves Migrations 000001-000061)
-- ====================================================================
--
-- Architectural Invariants & Guarantees:
-- 1. Snapshot-First Lifecycle:
--    - Operates strictly against the already-existing active immutable snapshot.
--    - Zero creation of new/replacement snapshots during pre-competition lock.
--    - Snapshots remain append-only and strictly immutable.
--
-- 2. Authoritative Database Persistence Guarantee:
--    - Performs atomic UPDATE on public.tournaments with RETURNING status.
--    - Enforces strict NOT FOUND and row mutation verification.
--    - If no row is updated or if persisted status is distinct from 'ONGOING', raises an explicit exception.
--    - Returns the verified database-persisted status in the JSON response payload, completely eliminating synthetic hardcoded state.
--
-- 3. Security & Privileges:
--    - SECURITY DEFINER with search_path = public, pg_temp.
--    - Preserves canonical RBAC (SUPER_ADMIN, ADMIN, ORGANIZER) with organizer ownership verification.
--    - Access granted strictly to authenticated users (revoked from anon/PUBLIC).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.lock_and_snapshot_tournament(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_tournament RECORD;
  v_active_snapshot_id UUID;
  v_active_version INTEGER;
  v_events_count INTEGER := 0;
  v_registrations_count INTEGER := 0;
  v_courts_count INTEGER := 0;
  v_persisted_status TEXT;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify RBAC permissions against live app_role enum
  SELECT ur.role::text INTO v_caller_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = v_caller_id 
    AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role, 'ORGANIZER'::public.app_role)
    AND p.status = 'ACTIVE'
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient privileges to lock tournament.'
      USING ERRCODE = '42501';
  END IF;

  v_is_super_admin := (v_caller_role = 'SUPER_ADMIN');
  v_is_organizer := (v_caller_role IN ('ORGANIZER', 'ADMIN'));

  -- 3. Lock and validate tournament
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament with ID % does not exist.', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_is_organizer AND NOT v_is_super_admin THEN
    IF v_tournament.organizer_id != v_caller_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Organizers can only lock tournaments they organize.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_tournament.status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament must be in REGISTRATION_OPEN or REGISTRATION_CLOSED status to lock for competition. Current: %', v_tournament.status
      USING ERRCODE = '22023';
  END IF;

  IF v_tournament.end_date < v_tournament.start_date THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament end date cannot be earlier than start date.'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Verify that an active snapshot exists (Snapshot-First invariant)
  SELECT id, version INTO v_active_snapshot_id, v_active_version
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id AND is_active = TRUE
  LIMIT 1;

  IF v_active_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament % has no active snapshot. Initial snapshot must be created before locking.', p_tournament_id
      USING ERRCODE = '22023';
  END IF;

  -- 5. Verify configured events under this snapshot
  SELECT COUNT(*) INTO v_events_count
  FROM public.events
  WHERE snapshot_id = v_active_snapshot_id;

  IF v_events_count = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: At least 1 event must be configured under snapshot % before locking tournament.', v_active_snapshot_id
      USING ERRCODE = '22023';
  END IF;

  -- 6. Verify approved athlete registrations
  SELECT COUNT(*) INTO v_registrations_count
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE e.snapshot_id = v_active_snapshot_id
    AND r.is_approved = TRUE;

  IF v_registrations_count = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: At least 1 approved athlete registration is required before locking tournament.'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Verify active courts
  SELECT COUNT(*) INTO v_courts_count
  FROM public.courts
  WHERE tournament_id = p_tournament_id AND is_active = TRUE;

  IF v_courts_count = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: At least 1 active court must be configured before locking tournament.'
      USING ERRCODE = '22023';
  END IF;

  -- 8. Hardened Status Transition with RETURNING & Row Mutation Verification
  UPDATE public.tournaments
  SET status = 'ONGOING',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_tournament_id
  RETURNING status::text INTO v_persisted_status;

  IF NOT FOUND OR v_persisted_status IS NULL THEN
    RAISE EXCEPTION 'PERSISTENCE_FAILED: Failed to update tournament % to ONGOING status. No rows were updated.', p_tournament_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_persisted_status IS DISTINCT FROM 'ONGOING' THEN
    RAISE EXCEPTION 'PERSISTENCE_FAILED: Tournament % status update failed. Persisted status is %, expected ONGOING.', p_tournament_id, v_persisted_status
      USING ERRCODE = '22000';
  END IF;

  -- 9. Record system audit log with verified live columns (executed only after confirmed persistence)
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
    v_caller_role,
    'LOCK_TOURNAMENT_REGISTRATIONS',
    'tournaments',
    p_tournament_id,
    p_tournament_id,
    jsonb_build_object(
      'snapshot_id', v_active_snapshot_id,
      'snapshot_version', v_active_version,
      'events_count', v_events_count,
      'approved_registrations_count', v_registrations_count,
      'courts_count', v_courts_count,
      'new_status', v_persisted_status
    ),
    timezone('utc'::text, now())
  );

  -- 10. Return authoritative response constructed strictly from database truth
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'snapshot_id', v_active_snapshot_id,
    'version', v_active_version,
    'status', v_persisted_status,
    'events_count', v_events_count,
    'registrations_count', v_registrations_count,
    'courts_count', v_courts_count
  );
END;
$$;

-- Permissions & Access Control
REVOKE ALL ON FUNCTION public.lock_and_snapshot_tournament(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_and_snapshot_tournament(UUID) TO authenticated;

COMMENT ON FUNCTION public.lock_and_snapshot_tournament(UUID) IS 'Phase 5: Registration / Pre-Competition Lock. Hardened canonical snapshot-first lifecycle lock. Validates events and rosters under active immutable snapshot, atomically updates tournament status to ONGOING with RETURNING verification, and returns authoritative database status.';
