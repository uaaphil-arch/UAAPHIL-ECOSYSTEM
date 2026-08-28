-- ============================================================================
-- Migration: 20260828000051_create_shift_lifecycle_and_reconciliation_rpcs.sql
-- Description: P7-03D Court Assignment Shift Lifecycle & Reconciliation
--
-- Authoritative Invariants Enforced:
-- INV-01: Zero offline auto-replay (PostgreSQL synchronous authoritative execution)
-- INV-02: PostgreSQL is authoritative single source of truth
-- INV-03: Snapshot immutability (No modification to snapshots, scoring, brackets)
-- INV-04: Strict server-side RBAC (SUPER_ADMIN, ADMIN, ORGANIZER, COURT_MANAGER)
-- INV-05: Court scoping (TABLE_OFFICIAL court-scoped, COURT_MANAGER event-wide)
-- INV-06: Cross-tournament isolation (events -> snapshots -> tournaments)
-- INV-07: Concurrency safety (Deterministic ORDER BY id ASC FOR UPDATE row locks)
-- INV-08: Active-bout fail-closed safety (ca.status = 'LIVE' OR m.status = 'IN_PROGRESS' -> 40902)
-- INV-09: Non-destructive history and structured audit logging (system_audit_logs)
-- ============================================================================

-- Optional performance index on active court assignments
CREATE INDEX IF NOT EXISTS event_assignments_court_active_idx
  ON public.event_assignments (court_id, is_active)
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- RPC 1: public.end_official_shift(p_assignment_id UUID)
-- Concludes a single active official shift (Table Official or Court Manager).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_official_shift(
  p_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role_label TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;

  v_assignment RECORD;
  v_event_id UUID;
  v_snapshot_id UUID;
  v_tournament_id UUID;
  v_organizer_id UUID;
  v_tournament_status TEXT;

  v_active_bout RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Authentication Check (INV-01 / INV-04)
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '40100';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_assignment_id cannot be null.'
      USING ERRCODE = '40001';
  END IF;

  -- 2. Lock and fetch target assignment (INV-07)
  SELECT *
  INTO v_assignment
  FROM public.event_assignments ea
  WHERE ea.id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event assignment % not found.', p_assignment_id
      USING ERRCODE = '40400';
  END IF;

  -- 3. Validate active status
  IF v_assignment.is_active = FALSE OR v_assignment.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT: Assignment % is already inactive or ended.', p_assignment_id
      USING ERRCODE = '40903';
  END IF;

  v_event_id := v_assignment.event_id;

  -- 4. Resolve Tournament Hierarchy (INV-06)
  SELECT e.id, ts.id, ts.tournament_id, t.organizer_id, t.status
  INTO v_event_id, v_snapshot_id, v_tournament_id, v_organizer_id, v_tournament_status
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event %, snapshot, or tournament chain not found.', v_event_id
      USING ERRCODE = '40400';
  END IF;

  -- 5. Authorization / RBAC Resolution (INV-04)
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ORGANIZER'::public.app_role AND v_organizer_id = v_requester_id),
    EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = v_event_id
        AND ea.user_id = v_requester_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.is_active = TRUE
        AND ea.revoked_at IS NULL
    )
  INTO v_is_super_admin, v_is_admin, v_is_organizer, v_is_court_manager;

  IF v_is_super_admin THEN
    v_requester_role_label := 'SUPER_ADMIN';
  ELSIF v_is_admin THEN
    v_requester_role_label := 'ADMIN';
  ELSIF v_is_organizer THEN
    v_requester_role_label := 'ORGANIZER';
  ELSIF v_is_court_manager THEN
    v_requester_role_label := 'COURT_MANAGER';
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to end official shift.'
      USING ERRCODE = '40300';
  END IF;

  -- Court Manager scoping restrictions
  IF v_requester_role_label = 'COURT_MANAGER' THEN
    IF v_assignment.role = 'COURT_MANAGER'::public.event_role THEN
      RAISE EXCEPTION 'FORBIDDEN: Court Manager cannot end Court Manager shifts. Must be performed by Tournament Organizer or Admin.'
        USING ERRCODE = '40300';
    END IF;
  END IF;

  -- 6. Role-Specific Invariants and Active-Bout Protection (INV-05 / INV-08)
  IF v_assignment.role = 'TABLE_OFFICIAL'::public.event_role THEN
    IF v_assignment.court_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Table official assignment missing court_id.'
        USING ERRCODE = '40003';
    END IF;

    -- Check court active bout
    SELECT ca.id, ca.match_id, m.match_number
    INTO v_active_bout
    FROM public.court_assignments ca
    LEFT JOIN public.matches m ON m.id = ca.match_id
    WHERE ca.court_id = v_assignment.court_id
      AND (
        ca.status = 'LIVE'::public.assignment_status
        OR (m.status IS NOT NULL AND m.status = 'IN_PROGRESS'::public.match_status)
      )
    LIMIT 1;

    IF v_active_bout.id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_BOUT_IN_PROGRESS: Cannot end Table Official shift while court has an active LIVE match (Match #%). Wait until match concludes.', v_active_bout.match_number
        USING ERRCODE = '40902';
    END IF;

  ELSIF v_assignment.role = 'COURT_MANAGER'::public.event_role THEN
    IF v_assignment.court_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Court manager assignment must have NULL court_id.'
        USING ERRCODE = '40003';
    END IF;

    -- Check event active bouts
    SELECT ca.id, ca.match_id, m.match_number
    INTO v_active_bout
    FROM public.court_assignments ca
    JOIN public.matches m ON m.id = ca.match_id
    WHERE m.event_id = v_event_id
      AND (
        ca.status = 'LIVE'::public.assignment_status
        OR m.status = 'IN_PROGRESS'::public.match_status
      )
    LIMIT 1;

    IF v_active_bout.id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_BOUT_IN_PROGRESS: Cannot end Court Manager shift while event has an active LIVE match (Match #%). Conclude active bouts first.', v_active_bout.match_number
        USING ERRCODE = '40902';
    END IF;
  END IF;

  -- 7. Non-Destructive Mutation (INV-09)
  UPDATE public.event_assignments
  SET
    is_active = FALSE,
    revoked_at = v_now,
    revoked_by = v_requester_id
  WHERE id = p_assignment_id;

  -- 8. Structured Audit Log (INV-09)
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
    v_requester_role_label,
    'OFFICIAL_SHIFT_END',
    'event_assignments',
    p_assignment_id,
    v_tournament_id,
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'event_id', v_event_id,
      'tournament_id', v_tournament_id,
      'official_user_id', v_assignment.user_id,
      'role', v_assignment.role,
      'court_id', v_assignment.court_id,
      'ended_at', v_now
    ),
    v_now
  );

  -- 9. Return Result
  RETURN jsonb_build_object(
    'success', true,
    'assignment_id', p_assignment_id,
    'event_id', v_event_id,
    'court_id', v_assignment.court_id,
    'official_user_id', v_assignment.user_id,
    'role', v_assignment.role,
    'ended_at', v_now
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 2: public.batch_end_official_shifts(p_event_id UUID, p_assignment_ids UUID[])
-- Atomically concludes multiple active official shifts in an event.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_end_official_shifts(
  p_event_id UUID,
  p_assignment_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role_label TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;

  v_event_id UUID;
  v_snapshot_id UUID;
  v_tournament_id UUID;
  v_organizer_id UUID;
  v_tournament_status TEXT;

  v_locked_assignments RECORD;
  v_locked_count INT := 0;
  v_input_count INT := 0;
  v_active_bout RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Authentication Check (INV-01 / INV-04)
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '40100';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_event_id cannot be null.'
      USING ERRCODE = '40001';
  END IF;

  IF p_assignment_ids IS NULL OR array_length(p_assignment_ids, 1) IS NULL OR array_length(p_assignment_ids, 1) = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_assignment_ids cannot be empty.'
      USING ERRCODE = '40002';
  END IF;

  v_input_count := array_length(p_assignment_ids, 1);

  -- Check for duplicates
  IF (SELECT count(DISTINCT x) FROM unnest(p_assignment_ids) x) <> v_input_count THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Duplicate assignment IDs detected in batch.'
      USING ERRCODE = '40003';
  END IF;

  -- 2. Resolve Tournament Hierarchy (INV-06)
  SELECT e.id, ts.id, ts.tournament_id, t.organizer_id, t.status
  INTO v_event_id, v_snapshot_id, v_tournament_id, v_organizer_id, v_tournament_status
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event %, snapshot, or tournament chain not found.', p_event_id
      USING ERRCODE = '40400';
  END IF;

  -- 3. Authorization / RBAC Resolution (INV-04)
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ORGANIZER'::public.app_role AND v_organizer_id = v_requester_id),
    EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.user_id = v_requester_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.is_active = TRUE
        AND ea.revoked_at IS NULL
    )
  INTO v_is_super_admin, v_is_admin, v_is_organizer, v_is_court_manager;

  IF v_is_super_admin THEN
    v_requester_role_label := 'SUPER_ADMIN';
  ELSIF v_is_admin THEN
    v_requester_role_label := 'ADMIN';
  ELSIF v_is_organizer THEN
    v_requester_role_label := 'ORGANIZER';
  ELSIF v_is_court_manager THEN
    v_requester_role_label := 'COURT_MANAGER';
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to batch end official shifts.'
      USING ERRCODE = '40300';
  END IF;

  -- 4. Deterministic Row Locking & Validation (INV-07 / INV-08)
  -- Loop through ordered assignments to validate all-or-nothing atomicity
  FOR v_locked_assignments IN
    SELECT ea.*
    FROM public.event_assignments ea
    WHERE ea.id = ANY(p_assignment_ids)
    ORDER BY ea.id ASC
    FOR UPDATE
  LOOP
    v_locked_count := v_locked_count + 1;

    -- Cross-event validation
    IF v_locked_assignments.event_id <> p_event_id THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment % does not belong to event %.', v_locked_assignments.id, p_event_id
        USING ERRCODE = '40004';
    END IF;

    -- Active status validation
    IF v_locked_assignments.is_active = FALSE OR v_locked_assignments.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'STALE_ASSIGNMENT: Assignment % is already inactive or ended.', v_locked_assignments.id
        USING ERRCODE = '40903';
    END IF;

    -- Court Manager scoping restrictions
    IF v_requester_role_label = 'COURT_MANAGER' AND v_locked_assignments.role = 'COURT_MANAGER'::public.event_role THEN
      RAISE EXCEPTION 'FORBIDDEN: Court Manager cannot end Court Manager shifts.'
        USING ERRCODE = '40300';
    END IF;

    -- Active-bout checks
    IF v_locked_assignments.role = 'TABLE_OFFICIAL'::public.event_role THEN
      IF v_locked_assignments.court_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Table official assignment % missing court_id.', v_locked_assignments.id
          USING ERRCODE = '40003';
      END IF;

      SELECT ca.id, ca.match_id, m.match_number
      INTO v_active_bout
      FROM public.court_assignments ca
      LEFT JOIN public.matches m ON m.id = ca.match_id
      WHERE ca.court_id = v_locked_assignments.court_id
        AND (
          ca.status = 'LIVE'::public.assignment_status
          OR (m.status IS NOT NULL AND m.status = 'IN_PROGRESS'::public.match_status)
        )
      LIMIT 1;

      IF v_active_bout.id IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE_BOUT_IN_PROGRESS: Cannot end Table Official shift on court % while active LIVE match is in progress (Match #%).', v_locked_assignments.court_id, v_active_bout.match_number
          USING ERRCODE = '40902';
      END IF;

    ELSIF v_locked_assignments.role = 'COURT_MANAGER'::public.event_role THEN
      SELECT ca.id, ca.match_id, m.match_number
      INTO v_active_bout
      FROM public.court_assignments ca
      JOIN public.matches m ON m.id = ca.match_id
      WHERE m.event_id = p_event_id
        AND (
          ca.status = 'LIVE'::public.assignment_status
          OR m.status = 'IN_PROGRESS'::public.match_status
        )
      LIMIT 1;

      IF v_active_bout.id IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE_BOUT_IN_PROGRESS: Cannot end Court Manager shift while event has an active LIVE match (Match #%).', v_active_bout.match_number
          USING ERRCODE = '40902';
      END IF;
    END IF;
  END LOOP;

  IF v_locked_count <> v_input_count THEN
    RAISE EXCEPTION 'NOT_FOUND: One or more target assignments do not exist in event %.', p_event_id
      USING ERRCODE = '40400';
  END IF;

  -- 5. Atomic Non-Destructive Update (INV-09)
  UPDATE public.event_assignments
  SET
    is_active = FALSE,
    revoked_at = v_now,
    revoked_by = v_requester_id
  WHERE id = ANY(p_assignment_ids);

  -- 6. Structured Audit Log (INV-09)
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
    v_requester_role_label,
    'OFFICIAL_SHIFT_END',
    'event_assignments',
    p_event_id,
    v_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'tournament_id', v_tournament_id,
      'ended_count', v_input_count,
      'ended_assignments', p_assignment_ids,
      'batch', true,
      'executed_at', v_now
    ),
    v_now
  );

  -- 7. Return Result
  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tournament_id', v_tournament_id,
    'ended_count', v_input_count,
    'ended_assignments', p_assignment_ids,
    'executed_at', v_now
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC 3: public.reconcile_event_assignments(p_event_id UUID)
-- Idempotently reconciles stale active assignments for an event.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_event_assignments(
  p_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role_label TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;

  v_event_id UUID;
  v_snapshot_id UUID;
  v_tournament_id UUID;
  v_organizer_id UUID;
  v_tournament_status TEXT;

  v_stale_ids UUID[];
  v_stale_count INT := 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Authentication Check (INV-01 / INV-04)
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '40100';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_event_id cannot be null.'
      USING ERRCODE = '40001';
  END IF;

  -- 2. Resolve Tournament Hierarchy (INV-06)
  SELECT e.id, ts.id, ts.tournament_id, t.organizer_id, t.status
  INTO v_event_id, v_snapshot_id, v_tournament_id, v_organizer_id, v_tournament_status
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event %, snapshot, or tournament chain not found.', p_event_id
      USING ERRCODE = '40400';
  END IF;

  -- 3. Authorization / RBAC Resolution (INV-04)
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ORGANIZER'::public.app_role AND v_organizer_id = v_requester_id),
    EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.user_id = v_requester_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.is_active = TRUE
        AND ea.revoked_at IS NULL
    )
  INTO v_is_super_admin, v_is_admin, v_is_organizer, v_is_court_manager;

  IF v_is_super_admin THEN
    v_requester_role_label := 'SUPER_ADMIN';
  ELSIF v_is_admin THEN
    v_requester_role_label := 'ADMIN';
  ELSIF v_is_organizer THEN
    v_requester_role_label := 'ORGANIZER';
  ELSIF v_is_court_manager THEN
    v_requester_role_label := 'COURT_MANAGER';
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to reconcile event assignments.'
      USING ERRCODE = '40300';
  END IF;

  -- 4. Find & Lock Stale Assignments Deterministically (INV-07 / INV-08)
  -- Stale criteria:
  -- 1) Tournament concluded or cancelled (status in 'COMPLETED', 'CANCELLED')
  -- 2) Court is deactivated (courts.is_active = FALSE)
  -- 3) Official profile is no longer active (profiles.account_status <> 'ACTIVE')
  --
  -- Active-Bout Safety Guard (INV-08):
  -- Skip any candidate assignment if its associated court (TABLE_OFFICIAL) or event (COURT_MANAGER)
  -- currently has an active LIVE court assignment or IN_PROGRESS match.
  SELECT ARRAY_AGG(sub.id ORDER BY sub.id ASC)
  INTO v_stale_ids
  FROM (
    SELECT ea.id
    FROM public.event_assignments ea
    LEFT JOIN public.courts c ON c.id = ea.court_id
    LEFT JOIN public.profiles p ON p.id = ea.user_id
    WHERE ea.event_id = p_event_id
      AND ea.is_active = TRUE
      AND ea.revoked_at IS NULL
      AND (
        v_tournament_status IN ('COMPLETED', 'CANCELLED')
        OR (ea.court_id IS NOT NULL AND c.is_active = FALSE)
        OR (p.account_status IS NOT NULL AND p.account_status <> 'ACTIVE'::public.account_status)
      )
      -- Active-bout exclusion (INV-08):
      AND NOT (
        (
          ea.role = 'TABLE_OFFICIAL'::public.event_role
          AND ea.court_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.court_assignments ca
            LEFT JOIN public.matches m ON m.id = ca.match_id
            WHERE ca.court_id = ea.court_id
              AND (
                ca.status = 'LIVE'::public.assignment_status
                OR (m.status IS NOT NULL AND m.status = 'IN_PROGRESS'::public.match_status)
              )
          )
        )
        OR
        (
          ea.role = 'COURT_MANAGER'::public.event_role
          AND EXISTS (
            SELECT 1
            FROM public.court_assignments ca
            JOIN public.matches m ON m.id = ca.match_id
            WHERE m.event_id = p_event_id
              AND (
                ca.status = 'LIVE'::public.assignment_status
                OR m.status = 'IN_PROGRESS'::public.match_status
              )
          )
        )
      )
    FOR UPDATE OF ea
  ) sub;

  v_stale_count := COALESCE(array_length(v_stale_ids, 1), 0);

  -- 5. Idempotent Handling: If no stale rows found, return clean success (INV-02)
  IF v_stale_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'tournament_id', v_tournament_id,
      'reconciled_count', 0,
      'reconciled_assignment_ids', '[]'::jsonb,
      'stale_reason', 'NONE',
      'reconciled_at', v_now
    );
  END IF;

  -- 6. Atomic Non-Destructive Update (INV-09)
  UPDATE public.event_assignments
  SET
    is_active = FALSE,
    revoked_at = v_now,
    revoked_by = v_requester_id
  WHERE id = ANY(v_stale_ids);

  -- 7. Structured Audit Log (INV-09)
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
    v_requester_role_label,
    'OFFICIAL_SHIFT_RECONCILED',
    'event_assignments',
    p_event_id,
    v_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'tournament_id', v_tournament_id,
      'reconciled_count', v_stale_count,
      'reconciled_assignment_ids', v_stale_ids,
      'reconciled_at', v_now
    ),
    v_now
  );

  -- 8. Return Result
  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tournament_id', v_tournament_id,
    'reconciled_count', v_stale_count,
    'reconciled_assignment_ids', v_stale_ids,
    'stale_reason', 'EVENT_CONCLUDED_OR_INACTIVE_COURT_OR_PROFILE',
    'reconciled_at', v_now
  );
END;
$$;
