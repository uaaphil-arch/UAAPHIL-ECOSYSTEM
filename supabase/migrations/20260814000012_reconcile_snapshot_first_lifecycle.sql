-- ====================================================================
-- MIGRATION: 20260814000012_reconcile_snapshot_first_lifecycle.sql
-- DESCRIPTION: Reconciles tournament lifecycle to strict SNAPSHOT-FIRST.
--              1. Adds public.create_initial_tournament_snapshot() (DRAFT phase).
--              2. Reconciles public.lock_and_snapshot_tournament() as Registration/Pre-Competition Lock.
--              3. Enforces database-level registration and event freezing upon ONGOING status.
--              4. Preserves 100% snapshot immutability and exact audit schema.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. FUNCTION: public.create_initial_tournament_snapshot
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_initial_tournament_snapshot(
  p_tournament_id UUID,
  p_configuration JSONB DEFAULT '{}'::jsonb
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
  v_existing_snapshot_id UUID;
  v_snapshot_id UUID;
  v_version INTEGER := 1;
  v_config JSONB;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify caller RBAC permissions against live app_role enum
  SELECT ur.role::text INTO v_caller_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = v_caller_id 
    AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role, 'ORGANIZER'::public.app_role)
    AND p.status = 'ACTIVE'
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient privileges to create tournament snapshots.'
      USING ERRCODE = '42501';
  END IF;

  v_is_super_admin := (v_caller_role = 'SUPER_ADMIN');
  v_is_organizer := (v_caller_role IN ('ORGANIZER', 'ADMIN'));

  -- 3. Lock and validate Tournament Existence and Status
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
      RAISE EXCEPTION 'FORBIDDEN: Organizers can only snapshot tournaments they organize.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Snapshot-First Invariant: Initial snapshot must be created in DRAFT
  IF v_tournament.status != 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_STATE: Initial snapshots can only be created when tournament status is DRAFT. Current status: %', v_tournament.status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Prevent duplicate active initial snapshots
  SELECT id INTO v_existing_snapshot_id
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id AND is_active = TRUE
  LIMIT 1;

  IF v_existing_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: An active tournament snapshot (%) already exists for tournament %.', v_existing_snapshot_id, p_tournament_id
      USING ERRCODE = '23505';
  END IF;

  -- 5. Calculate Snapshot Version
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id;

  -- 6. Build canonical initial snapshot configuration payload
  v_config := COALESCE(p_configuration, '{}'::jsonb) || jsonb_build_object(
    'initialized_at', timezone('utc'::text, now()),
    'initialized_by', v_caller_id,
    'initialized_by_role', v_caller_role,
    'tournament_id', p_tournament_id,
    'schema_version', '1.0'
  );

  -- 7. Insert initial immutable snapshot record
  INSERT INTO public.tournament_snapshots (
    tournament_id,
    configuration,
    version,
    is_active,
    created_at
  ) VALUES (
    p_tournament_id,
    v_config,
    v_version,
    TRUE,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_snapshot_id;

  -- 8. Log audit record with verified live columns
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
    'INITIALIZE_TOURNAMENT_SNAPSHOT',
    'tournament_snapshots',
    v_snapshot_id,
    p_tournament_id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'version', v_version
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'snapshot_id', v_snapshot_id,
    'version', v_version,
    'tournament_id', p_tournament_id
  );
END;
$$;

-- --------------------------------------------------------------------
-- 2. RECONCILED FUNCTION: public.lock_and_snapshot_tournament
-- (Registration / Pre-Competition Lock Routine)
-- --------------------------------------------------------------------
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

  -- 4. Verify that an active snapshot exists
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

  -- 8. Transition tournament status to ONGOING (Zero mutation of tournament_snapshots)
  UPDATE public.tournaments
  SET status = 'ONGOING',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_tournament_id;

  -- 9. Record system audit log with verified live columns
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
      'new_status', 'ONGOING'
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'snapshot_id', v_active_snapshot_id,
    'version', v_active_version,
    'status', 'ONGOING',
    'events_count', v_events_count,
    'registrations_count', v_registrations_count,
    'courts_count', v_courts_count
  );
END;
$$;

-- --------------------------------------------------------------------
-- 3. RLS LIFECYCLE GUARDS & IMMUTABILITY FOR REGISTRATIONS & EVENTS
-- --------------------------------------------------------------------

-- Ensure athlete self-registration is strictly blocked unless status is REGISTRATION_OPEN
DROP POLICY IF EXISTS "Athletes can register themselves" ON public.registrations;
CREATE POLICY "Athletes can register themselves"
  ON public.registrations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id 
    AND is_approved = FALSE
    AND EXISTS (
      SELECT 1 
      FROM public.events e
      JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
      JOIN public.tournaments t ON t.id = ts.tournament_id
      WHERE e.id = event_id
        AND t.status = 'REGISTRATION_OPEN'
    )
  );

-- Ensure athlete self-updates are strictly blocked unless status is REGISTRATION_OPEN
DROP POLICY IF EXISTS "Athletes can update unapproved registrations" ON public.registrations;
CREATE POLICY "Athletes can update unapproved registrations"
  ON public.registrations
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id 
    AND NOT is_approved
    AND EXISTS (
      SELECT 1 
      FROM public.events e
      JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
      JOIN public.tournaments t ON t.id = ts.tournament_id
      WHERE e.id = registrations.event_id
        AND t.status = 'REGISTRATION_OPEN'
    )
  )
  WITH CHECK (
    auth.uid() = user_id 
    AND NOT is_approved 
    AND approved_by IS NULL
    AND weigh_in_weight IS NULL
    AND EXISTS (
      SELECT 1 
      FROM public.events e
      JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
      JOIN public.tournaments t ON t.id = ts.tournament_id
      WHERE e.id = registrations.event_id
        AND t.status = 'REGISTRATION_OPEN'
    )
  );

-- Registration Immutability Trigger: Absolute engine-level lock for ONGOING, COMPLETED, CANCELLED tournaments
CREATE OR REPLACE FUNCTION public.enforce_registration_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tournament_status public.tournament_status;
  v_target_event_id UUID;
BEGIN
  v_target_event_id := COALESCE(OLD.event_id, NEW.event_id);

  SELECT t.status INTO v_tournament_status
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_target_event_id;

  -- Block all UPDATE or DELETE if tournament is in competition or finished
  IF v_tournament_status IN ('ONGOING', 'COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'FORBIDDEN: Registrations are locked and immutable when tournament status is %', v_tournament_status
      USING ERRCODE = '42501';
  END IF;

  -- Maintain existing event_id and user_id immutability for non-superadmins during registration phases
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
  BEFORE UPDATE OR DELETE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_immutability();

-- Ensure event modification is blocked once tournament is ONGOING or COMPLETED
DROP POLICY IF EXISTS "Organizers can manage events" ON public.events;
CREATE POLICY "Organizers can manage events"
  ON public.events
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournament_snapshots ts
      JOIN public.tournaments t ON t.id = ts.tournament_id
      LEFT JOIN public.user_roles ur ON ur.user_id = auth.uid()
      WHERE ts.id = snapshot_id
        AND (
          ur.role = 'SUPER_ADMIN'::public.app_role
          OR (ur.role IN ('ADMIN'::public.app_role, 'ORGANIZER'::public.app_role) AND t.organizer_id = auth.uid())
        )
        AND t.status = 'DRAFT'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tournament_snapshots ts
      JOIN public.tournaments t ON t.id = ts.tournament_id
      LEFT JOIN public.user_roles ur ON ur.user_id = auth.uid()
      WHERE ts.id = snapshot_id
        AND (
          ur.role = 'SUPER_ADMIN'::public.app_role
          OR (ur.role IN ('ADMIN'::public.app_role, 'ORGANIZER'::public.app_role) AND t.organizer_id = auth.uid())
        )
        AND t.status = 'DRAFT'
    )
  );

-- --------------------------------------------------------------------
-- 4. PERMISSIONS & GRANTS
-- --------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_initial_tournament_snapshot(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_initial_tournament_snapshot(UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.lock_and_snapshot_tournament(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_and_snapshot_tournament(UUID) TO authenticated;

COMMENT ON FUNCTION public.create_initial_tournament_snapshot IS 'Phase 1: Provisions initial immutable tournament snapshot (Version 1) strictly in DRAFT status.';
COMMENT ON FUNCTION public.lock_and_snapshot_tournament IS 'Phase 5: Registration / Pre-Competition Lock. Validates events and rosters under active snapshot and transitions status to ONGOING without snapshot mutation.';
