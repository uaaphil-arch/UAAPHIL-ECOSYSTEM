-- Migration: 20260824000044_reconcile_competition_engine_integrity.sql
-- Description: Reconciles competition engine integrity, relational snapshot-to-bracket contracts,
--              automated Bronze Match generation, Anyo tournament resolution, tournament finalization,
--              and standardizes SECURITY DEFINER search_path = public, pg_temp.
-- Target System: UAAPHIL Tournament System
-- Sequence: 000044 (Atomic, Non-destructive, Strict Precedence Reconciliation)

-- ============================================================================
-- 0. SAFE FUNCTION SIGNATURE CLEANUP (PREVENT OVERLOAD CONFLICTS)
-- ============================================================================
DROP FUNCTION IF EXISTS public.assign_event_role(UUID, UUID, public.event_role, UUID);
DROP FUNCTION IF EXISTS public.revoke_event_role(UUID);
DROP FUNCTION IF EXISTS public.assign_match_to_court(UUID, UUID);
DROP FUNCTION IF EXISTS public.start_court_match(UUID);
DROP FUNCTION IF EXISTS public.start_court_match(UUID, UUID);
DROP FUNCTION IF EXISTS public.complete_court_match(UUID, UUID, public.decision_type);
DROP FUNCTION IF EXISTS public.complete_court_match(UUID, UUID);
DROP FUNCTION IF EXISTS public.generate_tournament_brackets(UUID);
DROP FUNCTION IF EXISTS public.initialize_anyo_category_session(UUID, UUID, UUID, public.anyo_panel_size, public.anyo_calc_method);
DROP FUNCTION IF EXISTS public.finalize_tournament(UUID, JSONB, TEXT);

-- ============================================================================
-- 1. RECONCILE: public.is_authorized_tournament_official (Hardened Search Path)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_authorized_tournament_official(
  p_user_id UUID,
  p_tournament_id UUID,
  p_event_id UUID,
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
  v_user_status public.account_status;
  v_resolved_tournament_id UUID;
  v_organizer_id UUID;
BEGIN
  -- 1. Validate Input
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2. Check User Account Status
  SELECT p.account_status
  INTO v_user_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_user_status IS NULL OR v_user_status <> 'ACTIVE'::public.account_status THEN
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

  -- 4. Resolve Tournament and Verify Organizer Ownership Server-Side
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

GRANT EXECUTE ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- ============================================================================
-- 2. RECONCILE: public.assign_event_role (Safe Uniqueness & Activation)
-- ============================================================================
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
  v_requester_status public.account_status;
  v_target_status public.account_status;
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
  SELECT p.account_status
  INTO v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester account is not active.' USING ERRCODE = '40300';
  END IF;

  -- 3. Check Target User Status
  SELECT p.account_status
  INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_status IS NULL OR v_target_status <> 'ACTIVE'::public.account_status THEN
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

GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) TO authenticated, service_role;

-- ============================================================================
-- 3. RECONCILE: public.revoke_event_role (Preserves EventAssignment Return)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.revoke_event_role(
  p_assignment_id UUID
)
RETURNS public.event_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_assignment public.event_assignments;
  v_resolved_tournament_id UUID;
  v_organizer_id UUID;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Target Assignment
  SELECT * INTO v_assignment
  FROM public.event_assignments
  WHERE id = p_assignment_id;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event assignment does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Resolve Tournament and Event Ownership
  SELECT ts.tournament_id, t.organizer_id
  INTO v_resolved_tournament_id, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_assignment.event_id;

  -- 4. Check Authorization
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF NOT (v_is_super_admin OR v_is_admin) THEN
    IF v_organizer_id = v_requester_id AND EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ORGANIZER'::public.app_role
    ) THEN
      v_is_organizer := TRUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = v_assignment.event_id
        AND ea.user_id = v_requester_id
        AND ea.role = 'COURT_MANAGER'::public.event_role
        AND ea.court_id IS NULL
        AND ea.is_active = TRUE
    ) INTO v_is_court_manager;

    IF v_is_organizer THEN
      NULL;
    ELSIF v_is_court_manager THEN
      IF v_assignment.role <> 'TABLE_OFFICIAL'::public.event_role THEN
        RAISE EXCEPTION 'FORBIDDEN: Court Managers can only revoke Table Official assignments.' USING ERRCODE = '40300';
      END IF;
    ELSE
      RAISE EXCEPTION 'FORBIDDEN: Insufficient privileges to revoke this event assignment.' USING ERRCODE = '40300';
    END IF;
  END IF;

  -- 5. Soft-Revoke (Deactivate) Assignment
  UPDATE public.event_assignments
  SET is_active = FALSE,
      revoked_at = NOW(),
      revoked_by = v_requester_id
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  -- 6. Audit Log
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
    'REVOKE_EVENT_ROLE',
    'EVENT_ASSIGNMENT',
    p_assignment_id,
    v_resolved_tournament_id,
    jsonb_build_object(
      'event_id', v_assignment.event_id,
      'revoked_user_id', v_assignment.user_id,
      'role', v_assignment.role,
      'court_id', v_assignment.court_id
    ),
    NOW()
  );

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_event_role(UUID) TO authenticated, service_role;

-- ============================================================================
-- 4. RECONCILE: public.assign_match_to_court (Hardened Search Path & Return)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_match_to_court(
  p_match_id UUID,
  p_court_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court RECORD;
  v_is_authorized BOOLEAN := FALSE;
  v_assignment_id UUID;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Match Details
  SELECT m.*, ts.tournament_id AS event_tournament_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = p_match_id;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Fetch Court Details
  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id;

  IF v_court.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist.' USING ERRCODE = '40401';
  END IF;

  -- Verify Tournament Alignment
  IF v_court.tournament_id <> v_match.event_tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Court and match belong to different tournaments.' USING ERRCODE = '40301';
  END IF;

  -- 4. Authorize Requester: Admins, Organizer, or Event COURT_MANAGER
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := NULL,
    p_allow_court_manager := TRUE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not authorized to dispatch matches for this event.' USING ERRCODE = '40300';
  END IF;

  -- 5. Match Pre-Conditions Check
  IF v_match.status NOT IN ('SCHEDULED'::public.match_status, 'PENDING'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Only SCHEDULED or PENDING matches can be dispatched to a court. Current: %', v_match.status USING ERRCODE = '40010';
  END IF;

  IF v_match.red_corner_registration_id IS NULL OR v_match.blue_corner_registration_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MATCH: Match participants are not fully resolved.' USING ERRCODE = '40011';
  END IF;

  -- 6. Cancel or update any existing assigned court assignment for this match
  SELECT id INTO v_assignment_id
  FROM public.court_assignments
  WHERE match_id = p_match_id AND status = 'ASSIGNED'::public.assignment_status
  LIMIT 1;

  IF v_assignment_id IS NOT NULL THEN
    UPDATE public.court_assignments
    SET court_id = p_court_id,
        assigned_by = v_requester_id,
        assigned_at = NOW()
    WHERE id = v_assignment_id;
  ELSE
    INSERT INTO public.court_assignments (
      court_id,
      match_id,
      status,
      assigned_at,
      assigned_by
    ) VALUES (
      p_court_id,
      p_match_id,
      'ASSIGNED'::public.assignment_status,
      NOW(),
      v_requester_id
    )
    RETURNING id INTO v_assignment_id;
  END IF;

  -- Update court identifier on match record
  UPDATE public.matches
  SET court_identifier = v_court.identifier,
      status = 'SCHEDULED'::public.match_status,
      updated_at = NOW()
  WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', v_assignment_id,
    'match_id', p_match_id,
    'court_id', p_court_id,
    'status', 'ASSIGNED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_match_to_court(UUID, UUID) TO authenticated, service_role;

-- ============================================================================
-- 5. RECONCILE: public.start_court_match (Canonical 1-Arg Signature & Return)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.start_court_match(
  p_court_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_assignment RECORD;
  v_match RECORD;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Fetch Court Assignment Details
  SELECT ca.*, c.tournament_id
  INTO v_assignment
  FROM public.court_assignments ca
  JOIN public.courts c ON c.id = ca.court_id
  WHERE ca.id = p_court_assignment_id;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court assignment does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Fetch Match Details
  SELECT m.*, ts.tournament_id AS event_tournament_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = v_assignment.match_id;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 4. Authorize: Admins, Organizer, COURT_MANAGER, or TABLE_OFFICIAL on this court
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := v_assignment.court_id,
    p_allow_court_manager := TRUE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not authorized to start matches on this court.' USING ERRCODE = '40300';
  END IF;

  -- 5. Match Lifecycle State Validation
  IF v_match.status NOT IN ('PENDING'::public.match_status, 'SCHEDULED'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Match cannot be started. Current status: %', v_match.status USING ERRCODE = '40021';
  END IF;

  -- 6. Strict Court Concurrency: Only 1 LIVE match per court
  IF EXISTS (
    SELECT 1 FROM public.court_assignments ca
    WHERE ca.court_id = v_assignment.court_id
      AND ca.id <> p_court_assignment_id
      AND ca.status = 'LIVE'::public.assignment_status
  ) THEN
    RAISE EXCEPTION 'CONCURRENCY_VIOLATION: Another match is currently LIVE on this court.' USING ERRCODE = '40902';
  END IF;

  -- 7. Transition Match and Court Assignment to LIVE
  UPDATE public.matches
  SET status = 'IN_PROGRESS'::public.match_status,
      updated_at = NOW()
  WHERE id = v_match.id;

  UPDATE public.court_assignments
  SET status = 'LIVE'::public.assignment_status
  WHERE id = p_court_assignment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'assignment_id', p_court_assignment_id,
    'match_id', v_match.id,
    'court_id', v_assignment.court_id,
    'status', 'LIVE',
    'started_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_court_match(UUID) TO authenticated, service_role;

-- ============================================================================
-- 6. RECONCILE: public.complete_court_match WITH AUTOMATED BRONZE MATCH GENERATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_court_match(
  p_match_id UUID,
  p_winner_registration_id UUID,
  p_decision_type public.decision_type DEFAULT 'POINTS'::public.decision_type
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_next_match RECORD;
  v_parent_match RECORD;
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
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Lock Source Match FOR UPDATE with Tournament Resolution
  SELECT m.*, ts.tournament_id AS event_tournament_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- Resolve court_id from active or assigned court_assignment
  SELECT ca.court_id INTO v_court_id
  FROM public.court_assignments ca
  WHERE ca.match_id = p_match_id AND ca.status IN ('LIVE'::public.assignment_status, 'ASSIGNED'::public.assignment_status)
  LIMIT 1;

  -- 3. Authorize: Admins, Organizer, COURT_MANAGER (event-wide), or TABLE_OFFICIAL (assigned court)
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := v_court_id,
    p_allow_court_manager := TRUE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not authorized to complete this match.' USING ERRCODE = '40300';
  END IF;

  -- 4. Match Lifecycle Validation
  IF v_match.status NOT IN ('LIVE'::public.match_status, 'SCHEDULED'::public.match_status, 'IN_PROGRESS'::public.match_status, 'PENDING'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Match is already finished or cannot be completed. Current status: %', v_match.status USING ERRCODE = '40040';
  END IF;

  -- Validate Winner Registration ID
  IF p_winner_registration_id IS NOT NULL 
     AND p_winner_registration_id IS DISTINCT FROM v_match.red_corner_registration_id 
     AND p_winner_registration_id IS DISTINCT FROM v_match.blue_corner_registration_id THEN
    RAISE EXCEPTION 'INVALID_WINNER: Winner must be either the Red or Blue competitor.' USING ERRCODE = '40041';
  END IF;

  -- 5. Mark Match Completed & Upsert Official Result
  UPDATE public.matches
  SET status = 'COMPLETED'::public.match_status,
      winner_registration_id = p_winner_registration_id,
      updated_at = NOW()
  WHERE id = p_match_id;

  INSERT INTO public.match_results (
    match_id,
    winner_registration_id,
    decision_type,
    is_official,
    finalized_by,
    finalized_at,
    created_at,
    updated_at
  ) VALUES (
    p_match_id,
    p_winner_registration_id,
    p_decision_type,
    TRUE,
    v_requester_id,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (match_id) DO UPDATE
  SET winner_registration_id = EXCLUDED.winner_registration_id,
      decision_type = EXCLUDED.decision_type,
      is_official = TRUE,
      finalized_by = v_requester_id,
      finalized_at = NOW(),
      updated_at = NOW();

  -- Update Court Assignment
  IF v_court_id IS NOT NULL THEN
    UPDATE public.court_assignments
    SET status = 'COMPLETED'::public.assignment_status
    WHERE match_id = p_match_id AND court_id = v_court_id;
  END IF;

  -- 6. Atomic Graph Progression: Advance Winner to Next Match Node
  IF v_match.next_match_id IS NOT NULL AND p_winner_registration_id IS NOT NULL THEN
    SELECT * INTO v_parent_match
    FROM public.matches
    WHERE id = v_match.next_match_id
    FOR UPDATE;

    IF v_parent_match.id IS NOT NULL THEN
      IF v_match.next_match_corner = 'RED' THEN
        UPDATE public.matches
        SET red_corner_registration_id = p_winner_registration_id,
            updated_at = NOW()
        WHERE id = v_match.next_match_id;
      ELSIF v_match.next_match_corner = 'BLUE' THEN
        UPDATE public.matches
        SET blue_corner_registration_id = p_winner_registration_id,
            updated_at = NOW()
        WHERE id = v_match.next_match_id;
      ELSE
        -- Fallback automatic slot assignment
        IF v_parent_match.red_corner_registration_id IS NULL THEN
          UPDATE public.matches
          SET red_corner_registration_id = p_winner_registration_id,
              updated_at = NOW()
          WHERE id = v_match.next_match_id;
        ELSIF v_parent_match.blue_corner_registration_id IS NULL AND v_parent_match.red_corner_registration_id <> p_winner_registration_id THEN
          UPDATE public.matches
          SET blue_corner_registration_id = p_winner_registration_id,
              updated_at = NOW()
          WHERE id = v_match.next_match_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 7. MANDATORY AUTOMATED BRONZE MATCH GENERATION (OPTION A CHECK)
  -- If completed match is a Semifinal (node 2 or node 3), check if Bronze Match applies
  IF v_match.bracket_node_index IN (2, 3) AND v_match.event_id IS NOT NULL THEN
    SELECT snapshot_id INTO v_event_snapshot_id
    FROM public.events
    WHERE id = v_match.event_id;

    IF v_event_snapshot_id IS NOT NULL THEN
      SELECT configuration INTO v_snapshot_config
      FROM public.tournament_snapshots
      WHERE id = v_event_snapshot_id;
    ELSE
      SELECT configuration INTO v_snapshot_config
      FROM public.tournament_snapshots
      WHERE tournament_id = v_match.event_tournament_id
      AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    -- Resolve Bracket System
    v_bracket_system := COALESCE(
      (
        SELECT e.bracket_system
        FROM public.events e
        WHERE e.id = v_match.event_id
        LIMIT 1
      ),
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
        SELECT elem->>'bracket_system'
        FROM jsonb_array_elements(COALESCE(v_snapshot_config->'events', '[]'::jsonb)) elem
        WHERE (elem->>'id')::uuid = v_match.event_id
        LIMIT 1
      ),
      'SINGLE_ELIMINATION_TWO_BRONZE'
    );

    IF v_bracket_system IN ('SINGLE_ELIMINATION_BRONZE_BOUT', 'WITH_BATTLE_FOR_BRONZE') THEN
      -- Check if BOTH Semifinals (node 2 and node 3) are now COMPLETED
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
          -- If already live or completed, prevent silent mutation
          IF v_existing_bronze.status IN ('IN_PROGRESS'::public.match_status, 'COMPLETED'::public.match_status) THEN
            IF (v_existing_bronze.red_corner_registration_id IS DISTINCT FROM v_semi1_loser_reg_id) OR
               (v_existing_bronze.blue_corner_registration_id IS DISTINCT FROM v_semi2_loser_reg_id) THEN
              RAISE EXCEPTION 'FORBIDDEN: Cannot modify Bronze Match participants because Bronze Match is already % (Match ID: %).',
                v_existing_bronze.status, v_existing_bronze.id
                USING ERRCODE = '42501';
            END IF;
          ELSE
            -- Update participants idempotently
            UPDATE public.matches
            SET red_corner_registration_id = v_semi1_loser_reg_id,
                blue_corner_registration_id = v_semi2_loser_reg_id,
                updated_at = NOW()
            WHERE id = v_existing_bronze.id;
            v_bronze_match_id := v_existing_bronze.id;
          END IF;
        ELSE
          -- Instantiate new Bronze Match node (bracket_node_index = 0)
          INSERT INTO public.matches (
            tournament_id,
            event_id,
            round_number,
            match_number,
            bracket_node_index,
            red_corner_registration_id,
            blue_corner_registration_id,
            status,
            created_at,
            updated_at
          ) VALUES (
            v_match.event_tournament_id,
            v_match.event_id,
            1,
            0,
            0,
            v_semi1_loser_reg_id,
            v_semi2_loser_reg_id,
            'SCHEDULED'::public.match_status,
            NOW(),
            NOW()
          )
          RETURNING id INTO v_bronze_match_id;

          -- System audit log for bronze match generation
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
            'SYSTEM',
            'AUTO_GENERATE_BRONZE_MATCH',
            'matches',
            v_bronze_match_id,
            v_match.event_tournament_id,
            jsonb_build_object(
              'event_id', v_match.event_id,
              'semi1_match_id', v_semi1.id,
              'semi2_match_id', v_semi2.id,
              'red_corner_registration_id', v_semi1_loser_reg_id,
              'blue_corner_registration_id', v_semi2_loser_reg_id
            ),
            NOW()
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'match_id', p_match_id,
    'winner_registration_id', p_winner_registration_id,
    'decision_type', p_decision_type,
    'status', 'COMPLETED',
    'bronze_match_id', v_bronze_match_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_court_match(UUID, UUID, public.decision_type) TO authenticated, service_role;

-- ============================================================================
-- 7. RECONCILE: public.generate_tournament_brackets (Relational Source of Truth)
-- ============================================================================
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
  v_requester_status public.account_status;
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
  v_seed INT;
  v_pair_idx INT;
  v_leaf_start_node INT;
  v_leaf_end_node INT;
  v_leaf_count INT;
  v_total_matches_generated INT := 0;
  v_active_matches_count INT := 0;
  v_events_processed INT := 0;
  v_p_red RECORD;
  v_p_blue RECORD;
  v_pair_p1 JSONB;
  v_pair_p2 JSONB;
BEGIN
  -- 1. Authenticate and verify admin privileges
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  SELECT ur.role::text, p.account_status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN or ADMIN can generate tournament brackets' USING ERRCODE = '40300';
  END IF;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active' USING ERRCODE = '40300';
  END IF;

  -- 2. Lock Target Tournament Row FOR UPDATE
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

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

GRANT EXECUTE ON FUNCTION public.generate_tournament_brackets(UUID) TO authenticated, service_role;

-- ============================================================================
-- 8. RECONCILE: public.initialize_anyo_category_session (Relational Snapshot Validation)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.initialize_anyo_category_session(
  p_tournament_id UUID,
  p_event_id UUID,
  p_court_id UUID DEFAULT NULL,
  p_panel_size public.anyo_panel_size DEFAULT '5_JUDGES',
  p_calc_method public.anyo_calc_method DEFAULT 'OLYMPIC_TRIM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_event RECORD;
  v_session RECORD;
  v_reg RECORD;
  v_order_counter INT := 1;
  v_session_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, p_tournament_id, p_event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized for this tournament' USING ERRCODE = '40300';
  END IF;

  -- 3. Fetch and validate event with snapshot tournament resolution
  SELECT e.*, ts.tournament_id AS snapshot_tournament_id
  INTO v_event
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE e.id = p_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.snapshot_tournament_id <> p_tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Event does not belong to tournament' USING ERRCODE = '42501';
  END IF;

  -- 4. Check or create session
  SELECT * INTO v_session FROM public.anyo_category_sessions
  WHERE tournament_id = p_tournament_id AND event_id = p_event_id;

  IF v_session.id IS NOT NULL THEN
    v_session_id := v_session.id;
  ELSE
    INSERT INTO public.anyo_category_sessions (
      tournament_id,
      event_id,
      court_id,
      panel_size,
      calc_method,
      status
    ) VALUES (
      p_tournament_id,
      p_event_id,
      p_court_id,
      p_panel_size,
      p_calc_method,
      'SCHEDULED'::public.anyo_session_status
    )
    RETURNING id INTO v_session_id;

    -- Fetch all approved registrations for this event
    FOR v_reg IN (
      SELECT r.id
      FROM public.registrations r
      WHERE r.event_id = p_event_id
      AND r.is_approved = TRUE
      ORDER BY r.created_at ASC
    ) LOOP
      INSERT INTO public.anyo_performances (
        session_id,
        tournament_id,
        event_id,
        registration_id,
        order_number,
        status
      ) VALUES (
        v_session_id,
        p_tournament_id,
        p_event_id,
        v_reg.id,
        v_order_counter,
        'WAITING'::public.anyo_performance_status
      );
      v_order_counter := v_order_counter + 1;
    END LOOP;
  END IF;

  -- 5. Audit Log
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
    'INITIALIZE_ANYO_SESSION',
    'ANYO_SESSION',
    v_session_id,
    p_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'court_id', p_court_id,
      'panel_size', p_panel_size,
      'calc_method', p_calc_method,
      'total_competitors', v_order_counter - 1
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', v_session_id,
    'tournament_id', p_tournament_id,
    'event_id', p_event_id,
    'total_performers', v_order_counter - 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initialize_anyo_category_session(UUID, UUID, UUID, public.anyo_panel_size, public.anyo_calc_method) TO authenticated, service_role;

-- ============================================================================
-- 9. RECONCILE: public.finalize_tournament (Reconciled Schema, JSONB Tally, Weigh-in Scope)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finalize_tournament(
  p_tournament_id UUID,
  p_signatories JSONB DEFAULT '[]'::jsonb,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_tourney RECORD;
  v_uncompleted_matches INT := 0;
  v_in_progress_matches INT := 0;
  v_unresolved_winners INT := 0;
  v_uncompleted_anyo INT := 0;
  v_unresolved_weighins INT := 0;
  v_total_completed_bouts INT := 0;
  v_total_completed_anyo INT := 0;
  v_total_delegations INT := 0;
  v_snapshot_active BOOLEAN := FALSE;
  v_snapshot_id UUID;
  v_seal_number TEXT;
  v_closure_hash TEXT;
  v_standings_json JSONB := '[]'::jsonb;
  v_champion_team TEXT := 'TBD';
  v_eligibility_summary JSONB;
  v_seal_record RECORD;
BEGIN
  -- A. RBAC check (SUPER_ADMIN or ADMIN)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to finalize tournament.' USING ERRCODE = '42501';
  END IF;

  v_is_authorized := public.is_admin_or_higher(v_user_id);

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: Only SUPER_ADMIN or ADMIN can finalize and seal a tournament.' USING ERRCODE = '42501';
  END IF;

  -- B. Fetch tournament record with FOR UPDATE lock
  SELECT * INTO v_tourney FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament with ID % not found.', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tourney.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Tournament (%) is already finalized and sealed.', p_tournament_id USING ERRCODE = 'P0001';
  END IF;

  IF v_tourney.status != 'ONGOING' THEN
    RAISE EXCEPTION 'Tournament must be in ONGOING state to be finalized (current status: %).', v_tourney.status USING ERRCODE = 'P0001';
  END IF;

  -- C. Preflight Check: Active snapshot exists
  SELECT is_active, id INTO v_snapshot_active, v_snapshot_id
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id AND is_active = TRUE
  ORDER BY version DESC LIMIT 1;

  IF v_snapshot_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Tournament snapshot is missing or not active.' USING ERRCODE = 'P0001';
  END IF;

  -- D. Preflight Check: Matches
  SELECT COUNT(*) INTO v_uncompleted_matches
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND court_identifier IS DISTINCT FROM 'BYE'
    AND status != 'COMPLETED'::public.match_status;

  IF v_uncompleted_matches > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % non-BYE matches remain uncompleted.', v_uncompleted_matches USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_in_progress_matches
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND status = 'IN_PROGRESS'::public.match_status;

  IF v_in_progress_matches > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % matches are currently IN_PROGRESS on competition courts.', v_in_progress_matches USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_unresolved_winners
  FROM public.matches
  WHERE tournament_id = p_tournament_id
    AND court_identifier IS DISTINCT FROM 'BYE'
    AND status = 'COMPLETED'::public.match_status
    AND winner_registration_id IS NULL;

  IF v_unresolved_winners > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % completed matches have unresolved winners.', v_unresolved_winners USING ERRCODE = 'P0001';
  END IF;

  -- E. Preflight Check: Anyo Performances
  SELECT COUNT(*) INTO v_uncompleted_anyo
  FROM public.anyo_performances
  WHERE tournament_id = p_tournament_id
    AND status != 'COMPLETED'::public.anyo_performance_status;

  IF v_uncompleted_anyo > 0 THEN
    RAISE EXCEPTION 'Finalization Preflight Failed: % Anyo performances remain uncompleted.', v_uncompleted_anyo USING ERRCODE = 'P0001';
  END IF;

  -- F. Preflight Check: Weigh-In Check (Only for eligible weight-classed Full Contact registrations)
  IF COALESCE(v_tourney.weigh_in_required, TRUE) = TRUE THEN
    SELECT COUNT(*) INTO v_unresolved_weighins
    FROM public.registrations r
    JOIN public.events e ON e.id = r.event_id
    JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
    WHERE ts.tournament_id = p_tournament_id
      AND r.is_approved = TRUE
      AND r.weigh_in_weight IS NULL
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
      AND e.weight_class IS NOT NULL
      AND e.weight_class != 'OPEN_WEIGHT';

    IF v_unresolved_weighins > 0 THEN
      RAISE EXCEPTION 'Finalization Preflight Failed: % approved Full Contact athletes have unresolved weigh-in weight.', v_unresolved_weighins USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- G. Compute Master Statistics
  SELECT COUNT(*) INTO v_total_completed_bouts
  FROM public.matches
  WHERE tournament_id = p_tournament_id 
    AND status = 'COMPLETED'::public.match_status 
    AND court_identifier IS DISTINCT FROM 'BYE';

  SELECT COUNT(*) INTO v_total_completed_anyo
  FROM public.anyo_performances
  WHERE tournament_id = p_tournament_id 
    AND status = 'COMPLETED'::public.anyo_performance_status;

  SELECT COUNT(DISTINCT COALESCE(c.name, r.team_name, 'Independent')) INTO v_total_delegations
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  LEFT JOIN public.clubs c ON c.id = r.club_id
  WHERE ts.tournament_id = p_tournament_id 
    AND r.is_approved = TRUE;

  -- H. Compute Standings / Medal Tally Snapshot directly from JSONB array
  BEGIN
    v_standings_json := public.get_tournament_medal_tally(p_tournament_id);
    IF jsonb_typeof(v_standings_json) = 'array' AND jsonb_array_length(v_standings_json) > 0 THEN
      v_champion_team := COALESCE(v_standings_json->0->>'team_name', v_standings_json->0->>'school_club', 'TBD');
    ELSE
      v_standings_json := '[]'::jsonb;
      v_champion_team := 'TBD';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to generate medal tally during finalization: %', SQLERRM USING ERRCODE = 'P0001';
  END;

  -- I. Eligibility summary
  v_eligibility_summary := jsonb_build_object(
    'weigh_in_required', COALESCE(v_tourney.weigh_in_required, TRUE),
    'total_delegations', v_total_delegations,
    'total_bouts_completed', v_total_completed_bouts,
    'total_anyo_completed', v_total_completed_anyo,
    'notes', p_notes
  );

  -- J. Generate Seal Number and Closure Hash
  v_seal_number := 'UAAPHIL-SEAL-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substring(p_tournament_id::text from 1 for 8));
  v_closure_hash := encode(digest(p_tournament_id::text || v_seal_number || now()::text || v_total_completed_bouts::text, 'sha256'), 'hex');

  -- K. Insert Closure Seal Record
  INSERT INTO public.tournament_closure_seals (
    tournament_id,
    seal_number,
    closure_hash,
    finalized_by,
    finalized_at,
    weigh_in_required,
    total_bouts_completed,
    total_anyo_performances,
    total_participating_delegations,
    champion_team_name,
    final_standings_snapshot,
    eligibility_summary,
    signatories,
    metadata
  ) VALUES (
    p_tournament_id,
    v_seal_number,
    v_closure_hash,
    v_user_id,
    NOW(),
    COALESCE(v_tourney.weigh_in_required, TRUE),
    v_total_completed_bouts,
    v_total_completed_anyo,
    v_total_delegations,
    v_champion_team,
    v_standings_json,
    v_eligibility_summary,
    COALESCE(p_signatories, '[]'::jsonb),
    jsonb_build_object(
      'finalized_by_user_id', v_user_id,
      'snapshot_id', v_snapshot_id,
      'notes', p_notes
    )
  )
  RETURNING * INTO v_seal_record;

  -- L. Transition Tournament Status to COMPLETED
  UPDATE public.tournaments
  SET status = 'COMPLETED',
      updated_at = NOW()
  WHERE id = p_tournament_id;

  -- M. System Audit Log
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
    v_user_id,
    'ADMIN',
    'FINALIZE_TOURNAMENT',
    'TOURNAMENT_CLOSURE_SEAL',
    v_seal_record.id,
    p_tournament_id,
    jsonb_build_object(
      'seal_number', v_seal_number,
      'closure_hash', v_closure_hash,
      'champion_team', v_champion_team,
      'total_bouts', v_total_completed_bouts,
      'total_anyo', v_total_completed_anyo
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'seal_id', v_seal_record.id,
    'seal_number', v_seal_number,
    'closure_hash', v_closure_hash,
    'finalized_at', v_seal_record.finalized_at,
    'weigh_in_required', COALESCE(v_tourney.weigh_in_required, TRUE),
    'total_bouts', v_total_completed_bouts,
    'total_anyo', v_total_completed_anyo,
    'champion_team', v_champion_team,
    'status', 'COMPLETED',
    'total_bouts_completed', v_total_completed_bouts,
    'total_anyo_performances', v_total_completed_anyo,
    'total_delegations', v_total_delegations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_tournament(UUID, JSONB, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 10. RECONCILE: public.enforce_completed_tournament_immutability (Hardened)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_completed_tournament_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tourney_id UUID;
  v_tourney_status TEXT;
BEGIN
  -- Determine tournament_id based on TG_TABLE_NAME
  IF TG_TABLE_NAME = 'tournaments' THEN
    IF OLD.status = 'COMPLETED' THEN
      RAISE EXCEPTION 'Tournament is finalized and sealed. Modifications to completed tournaments are strictly forbidden.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'matches' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSIF TG_TABLE_NAME = 'scoring_rounds' THEN
    SELECT m.tournament_id INTO v_tourney_id FROM public.matches m WHERE m.id = COALESCE(OLD.match_id, NEW.match_id);
  ELSIF TG_TABLE_NAME = 'anyo_performances' THEN
    v_tourney_id := COALESCE(OLD.tournament_id, NEW.tournament_id);
  ELSIF TG_TABLE_NAME = 'anyo_scores' THEN
    SELECT ap.tournament_id INTO v_tourney_id FROM public.anyo_performances ap WHERE ap.id = COALESCE(OLD.performance_id, NEW.performance_id);
  ELSIF TG_TABLE_NAME = 'registrations' THEN
    SELECT ts.tournament_id INTO v_tourney_id
    FROM public.events e
    JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
    WHERE e.id = COALESCE(OLD.event_id, NEW.event_id);
  ELSIF TG_TABLE_NAME = 'court_assignments' THEN
    SELECT m.tournament_id INTO v_tourney_id FROM public.matches m WHERE m.id = COALESCE(OLD.match_id, NEW.match_id);
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_tourney_id IS NOT NULL THEN
    SELECT status INTO v_tourney_status FROM public.tournaments WHERE id = v_tourney_id;
    IF v_tourney_status = 'COMPLETED' THEN
      RAISE EXCEPTION 'Tournament (%) is finalized and sealed. Database mutation on % is strictly forbidden.', v_tourney_id, TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
