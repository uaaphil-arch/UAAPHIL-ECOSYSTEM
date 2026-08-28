-- Migration: 20260820000036_reconcile_official_authorization_and_court_operations.sql
-- Description: Reconcile tournament official authorization, event role assignment, court dispatch, and scoring operations.
--
-- Authoritative Architecture:
-- 1. Tournament Organizer: Owns tournament; assigns/revokes COURT_MANAGER (event-wide) & TABLE_OFFICIAL (court-specific).
-- 2. COURT_MANAGER: Event-wide dispatch/queue manager (court_id = NULL, max 1 active per event).
--    - CAN dispatch matches, manage court queue, start matches, complete matches, and delegate TABLE_OFFICIAL.
--    - CANNOT record round scores, manage court structure, or assign permanent user_roles.
-- 3. TABLE_OFFICIAL: Court-specific match & scoring operator (court_id != NULL, multiple concurrent active officials allowed per court).
--    - CAN start matches, record round scores, and complete matches ONLY on assigned court.
--    - CANNOT dispatch matches, operate other courts, or assign officials.
-- 4. Server-Side Resolution: All ownership resolved via events -> tournament_snapshots -> tournaments. No reliance on client tournament IDs.
-- 5. Exact Live Database & Frontend Signature Compatibility:
--    - assign_event_role & revoke_event_role RETURN public.event_assignments
--    - start_court_match accepts (p_court_assignment_id UUID)
--    - complete_court_match accepts (p_match_id UUID, p_winner_registration_id UUID, p_decision_type public.decision_type DEFAULT 'POINTS')
--    - record_round_score accepts live arguments (red_advantage, blue_advantage, winner_corner, is_confirmed)
--    - profiles status check strictly uses account_status = 'ACTIVE' (no non-existent status column)
-- 6. Postgres 42P13 Safeguard:
--    - Drops exact existing overloaded or modified function signatures before recreation to avoid 42P13 (cannot remove parameter defaults).

-- ============================================================================
-- 0. SAFE DROP EXISTING FUNCTIONS TO PREVENT POSTGRES 42P13 CONFLICTS
-- ============================================================================
DROP FUNCTION IF EXISTS public.complete_court_match(UUID, UUID, public.decision_type);
DROP FUNCTION IF EXISTS public.complete_court_match(UUID, UUID);
DROP FUNCTION IF EXISTS public.start_court_match(UUID);
DROP FUNCTION IF EXISTS public.assign_match_to_court(UUID, UUID);
DROP FUNCTION IF EXISTS public.record_round_score(UUID, INT, INT, INT, BOOLEAN, BOOLEAN, public.corner_color, BOOLEAN);
DROP FUNCTION IF EXISTS public.assign_event_role(UUID, UUID, public.event_role, UUID);
DROP FUNCTION IF EXISTS public.revoke_event_role(UUID);
DROP FUNCTION IF EXISTS public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.is_authorized_tournament_official(UUID, UUID, UUID);

-- ============================================================================
-- 1. RECONCILE HELPER: public.is_authorized_tournament_official
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
SET search_path = public
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

  -- 2. Check User Account Status (using authoritative account_status enum)
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
  -- COURT_MANAGER must have court_id IS NULL and is_active = TRUE
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
  -- TABLE_OFFICIAL requires exact event_id + court_id match
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

-- ============================================================================
-- 2. RECONCILE RPC: public.assign_event_role
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
SET search_path = public
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
  v_assignment public.event_assignments;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Prevent Self-Assignment
  IF v_requester_id = p_user_id THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT: Users cannot assign operational roles to themselves.' USING ERRCODE = '40001';
  END IF;

  -- 3. Validate Requester Status
  SELECT p.account_status
  INTO v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester account is not active.' USING ERRCODE = '40300';
  END IF;

  -- 4. Validate Target User Status
  SELECT p.account_status
  INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Target user profile does not exist.' USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target user profile is not active.' USING ERRCODE = '40002';
  END IF;

  -- 5. Resolve Event, Tournament, and Organizer Server-Side
  SELECT ts.tournament_id, t.organizer_id
  INTO v_resolved_tournament_id, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_resolved_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Competition event does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 6. Evaluate Requester Authority
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF v_organizer_id = v_requester_id AND EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role IN ('ORGANIZER'::public.app_role, 'ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role)
  ) THEN
    v_is_organizer := TRUE;
  END IF;

  -- Check if requester is an active COURT_MANAGER for this event
  SELECT EXISTS (
    SELECT 1 FROM public.event_assignments ea
    WHERE ea.event_id = p_event_id
      AND ea.user_id = v_requester_id
      AND ea.role = 'COURT_MANAGER'::public.event_role
      AND ea.court_id IS NULL
      AND ea.is_active = TRUE
  ) INTO v_is_court_manager;

  -- Authorization Gate
  IF NOT (v_is_super_admin OR v_is_admin OR v_is_organizer OR v_is_court_manager) THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to assign tournament operational roles.' USING ERRCODE = '40300';
  END IF;

  -- 7. Validate Role-Specific Invariants
  IF p_role = 'COURT_MANAGER'::public.event_role THEN
    -- Only SUPER_ADMIN, ADMIN, or Tournament Owner can assign COURT_MANAGER
    IF NOT (v_is_super_admin OR v_is_admin OR v_is_organizer) THEN
      RAISE EXCEPTION 'FORBIDDEN: Court Managers cannot assign other Court Managers.' USING ERRCODE = '40300';
    END IF;

    -- COURT_MANAGER must be event-wide (court_id MUST be NULL)
    IF p_court_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: COURT_MANAGER is an event-wide role and must not have a court_id.' USING ERRCODE = '40003';
    END IF;

    -- Deactivate any existing active COURT_MANAGER for this event before assigning new one
    UPDATE public.event_assignments
    SET is_active = FALSE,
        revoked_at = NOW(),
        revoked_by = v_requester_id
    WHERE event_id = p_event_id
      AND role = 'COURT_MANAGER'::public.event_role
      AND is_active = TRUE;

  ELSIF p_role = 'TABLE_OFFICIAL'::public.event_role THEN
    -- TABLE_OFFICIAL requires exact court_id
    IF p_court_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: TABLE_OFFICIAL requires a valid court_id.' USING ERRCODE = '40004';
    END IF;

    -- Verify Court belongs to Tournament
    SELECT c.tournament_id INTO v_court_tournament_id
    FROM public.courts c
    WHERE c.id = p_court_id;

    IF v_court_tournament_id IS NULL OR v_court_tournament_id <> v_resolved_tournament_id THEN
      RAISE EXCEPTION 'INVALID_COURT: Court does not belong to this event tournament.' USING ERRCODE = '40005';
    END IF;

    -- Prevent duplicate active assignment of the SAME user to the same event/court/role
    IF EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.court_id = p_court_id
        AND ea.user_id = p_user_id
        AND ea.role = 'TABLE_OFFICIAL'::public.event_role
        AND ea.is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT: User is already an active Table Official on this court.' USING ERRCODE = '40901';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_ROLE: Unsupported operational role %', p_role USING ERRCODE = '40006';
  END IF;

  -- 8. Insert Assignment and return record
  INSERT INTO public.event_assignments (
    event_id,
    user_id,
    role,
    court_id,
    assigned_by,
    is_active,
    created_at
  ) VALUES (
    p_event_id,
    p_user_id,
    p_role,
    p_court_id,
    v_requester_id,
    TRUE,
    NOW()
  )
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

-- ============================================================================
-- 3. RECONCILE RPC: public.revoke_event_role
-- ============================================================================
CREATE OR REPLACE FUNCTION public.revoke_event_role(
  p_assignment_id UUID
)
RETURNS public.event_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID;
  v_assignment public.event_assignments;
  v_event_id UUID;
  v_role public.event_role;
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

  -- 2. Fetch Active Assignment
  SELECT ea.*, t.organizer_id
  INTO v_assignment
  FROM public.event_assignments ea
  JOIN public.events e ON e.id = ea.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE ea.id = p_assignment_id;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Assignment does not exist.' USING ERRCODE = '40400';
  END IF;

  IF NOT v_assignment.is_active THEN
    RETURN v_assignment;
  END IF;

  v_event_id := v_assignment.event_id;
  v_role := v_assignment.role;

  -- 3. Evaluate Requester Authority
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  SELECT (t.organizer_id = v_requester_id)
  INTO v_is_organizer
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_event_id;

  -- Check if requester is active COURT_MANAGER for this event
  SELECT EXISTS (
    SELECT 1 FROM public.event_assignments ea
    WHERE ea.event_id = v_event_id
      AND ea.user_id = v_requester_id
      AND ea.role = 'COURT_MANAGER'::public.event_role
      AND ea.court_id IS NULL
      AND ea.is_active = TRUE
  ) INTO v_is_court_manager;

  -- Court Manager can only revoke TABLE_OFFICIAL assignments in their event
  IF v_is_court_manager AND v_role = 'COURT_MANAGER'::public.event_role AND NOT (v_is_super_admin OR v_is_admin OR v_is_organizer) THEN
    RAISE EXCEPTION 'FORBIDDEN: Court Managers cannot revoke other Court Managers.' USING ERRCODE = '40300';
  END IF;

  IF NOT (v_is_super_admin OR v_is_admin OR v_is_organizer OR (v_is_court_manager AND v_role = 'TABLE_OFFICIAL'::public.event_role)) THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to revoke operational role.' USING ERRCODE = '40300';
  END IF;

  -- 4. Revoke Assignment
  UPDATE public.event_assignments
  SET is_active = FALSE,
      revoked_at = NOW(),
      revoked_by = v_requester_id
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

-- ============================================================================
-- 4. RECONCILE RPC: public.assign_match_to_court (Court Dispatch)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_match_to_court(
  p_match_id UUID,
  p_court_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE m.id = p_match_id
  INTO v_match;

  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Match does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Fetch Court Details
  SELECT c.* INTO v_court
  FROM public.courts c
  WHERE c.id = p_court_id;

  IF v_court.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist.' USING ERRCODE = '40400';
  END IF;

  IF NOT v_court.is_active THEN
    RAISE EXCEPTION 'INVALID_COURT: Court is inactive.' USING ERRCODE = '40010';
  END IF;

  -- 4. Verify Court Belongs to Match Tournament
  IF v_court.tournament_id <> v_match.event_tournament_id THEN
    RAISE EXCEPTION 'INVALID_COURT: Court belongs to a different tournament.' USING ERRCODE = '40011';
  END IF;

  -- 5. Authorize Requester: Admins, Organizer, or COURT_MANAGER (Dispatch Authority)
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_court.tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := NULL,
    p_allow_court_manager := TRUE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Tournament Organizers, Admins, or Court Managers can dispatch matches to courts.' USING ERRCODE = '40300';
  END IF;

  -- 6. Match Lifecycle State Validation
  IF v_match.status NOT IN ('PENDING'::public.match_status, 'SCHEDULED'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Only PENDING or SCHEDULED matches can be assigned to a court. Current status: %', v_match.status USING ERRCODE = '40012';
  END IF;

  -- 7. Cancel prior pending assignment for this match if any
  UPDATE public.court_assignments
  SET status = 'CANCELLED'::public.court_assignment_status,
      updated_at = NOW()
  WHERE match_id = p_match_id AND status IN ('ASSIGNED'::public.court_assignment_status, 'SCHEDULED'::public.court_assignment_status);

  -- Insert Court Assignment
  INSERT INTO public.court_assignments (
    court_id,
    match_id,
    status,
    assigned_at
  ) VALUES (
    p_court_id,
    p_match_id,
    'ASSIGNED'::public.court_assignment_status,
    NOW()
  )
  RETURNING id INTO v_assignment_id;

  -- Update Match with court identifier
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

-- ============================================================================
-- 5. RECONCILE RPC: public.start_court_match
-- ============================================================================
CREATE OR REPLACE FUNCTION public.start_court_match(
  p_court_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- 4. Authorize: Admins, Organizer, COURT_MANAGER (event-wide), or TABLE_OFFICIAL (assigned court)
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

  -- 5. Match Lifecycle Validation
  IF v_match.status NOT IN ('PENDING'::public.match_status, 'SCHEDULED'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Match cannot be started. Current status: %', v_match.status USING ERRCODE = '40021';
  END IF;

  -- 6. Strict Court Concurrency: Only 1 LIVE match per court
  IF EXISTS (
    SELECT 1 FROM public.court_assignments ca
    WHERE ca.court_id = v_assignment.court_id
      AND ca.id <> p_court_assignment_id
      AND ca.status = 'LIVE'::public.court_assignment_status
  ) THEN
    RAISE EXCEPTION 'CONCURRENCY_VIOLATION: Another match is currently LIVE on this court.' USING ERRCODE = '40902';
  END IF;

  -- 7. Transition Match and Court Assignment to LIVE
  UPDATE public.matches
  SET status = 'LIVE'::public.match_status,
      updated_at = NOW()
  WHERE id = v_match.id;

  UPDATE public.court_assignments
  SET status = 'LIVE'::public.court_assignment_status,
      started_at = NOW(),
      updated_at = NOW()
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

-- ============================================================================
-- 6. RECONCILE RPC: public.record_round_score (Scoring Strict Isolation)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_round_score(
  p_match_id UUID,
  p_round_number INT,
  p_red_score INT,
  p_blue_score INT,
  p_red_advantage BOOLEAN DEFAULT FALSE,
  p_blue_advantage BOOLEAN DEFAULT FALSE,
  p_winner_corner public.corner_color DEFAULT NULL,
  p_is_confirmed BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_score_id UUID;
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

  -- Resolve court_id from active court_assignment
  SELECT ca.court_id INTO v_court_id
  FROM public.court_assignments ca
  WHERE ca.match_id = p_match_id AND ca.status = 'LIVE'::public.court_assignment_status
  LIMIT 1;

  IF v_court_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Match is not currently LIVE on any court.' USING ERRCODE = '40030';
  END IF;

  -- 3. Strict Scoring Authorization Gate:
  -- Admins, Organizer, or TABLE_OFFICIAL on assigned court.
  -- COURT_MANAGER is explicitly DENIED (p_allow_court_manager := FALSE).
  v_is_authorized := public.is_authorized_tournament_official(
    p_user_id := v_requester_id,
    p_tournament_id := v_match.event_tournament_id,
    p_event_id := v_match.event_id,
    p_court_id := v_court_id,
    p_allow_court_manager := FALSE
  );

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Only assigned Table Officials and Tournament Administrators can record round scores. Court Managers are not authorized to score.' USING ERRCODE = '40300';
  END IF;

  -- 4. Match Lifecycle Validation
  IF v_match.status <> 'LIVE'::public.match_status THEN
    RAISE EXCEPTION 'INVALID_STATE: Scores can only be recorded for LIVE matches. Current status: %', v_match.status USING ERRCODE = '40031';
  END IF;

  -- 5. Insert Round Score
  INSERT INTO public.scoring_rounds (
    match_id,
    round_number,
    red_score,
    blue_score,
    red_advantage,
    blue_advantage,
    winner_corner,
    judge_id,
    is_confirmed
  ) VALUES (
    p_match_id,
    p_round_number,
    p_red_score,
    p_blue_score,
    COALESCE(p_red_advantage, FALSE),
    COALESCE(p_blue_advantage, FALSE),
    p_winner_corner,
    v_requester_id,
    COALESCE(p_is_confirmed, FALSE)
  )
  RETURNING id INTO v_score_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'score_id', v_score_id,
    'match_id', p_match_id,
    'round_number', p_round_number,
    'red_score', p_red_score,
    'blue_score', p_blue_score,
    'recorded_by', v_requester_id
  );
END;
$$;

-- ============================================================================
-- 7. RECONCILE RPC: public.complete_court_match (Finalization & Progression)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_court_match(
  p_match_id UUID,
  p_winner_registration_id UUID,
  p_decision_type public.decision_type DEFAULT 'POINTS'::public.decision_type
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID;
  v_match RECORD;
  v_court_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_next_match RECORD;
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

  -- Resolve court_id from active or assigned court_assignment
  SELECT ca.court_id INTO v_court_id
  FROM public.court_assignments ca
  WHERE ca.match_id = p_match_id AND ca.status IN ('LIVE'::public.court_assignment_status, 'ASSIGNED'::public.court_assignment_status)
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
  IF v_match.status NOT IN ('LIVE'::public.match_status, 'SCHEDULED'::public.match_status, 'PENDING'::public.match_status) THEN
    RAISE EXCEPTION 'INVALID_STATE: Match is already finished or cannot be completed. Current status: %', v_match.status USING ERRCODE = '40040';
  END IF;

  -- Validate Winner Registration ID
  IF p_winner_registration_id IS NOT NULL AND p_winner_registration_id <> v_match.red_corner_registration_id AND p_winner_registration_id <> v_match.blue_corner_registration_id THEN
    RAISE EXCEPTION 'INVALID_WINNER: Winner must be either the Red or Blue competitor.' USING ERRCODE = '40041';
  END IF;

  -- 5. Mark Match Completed
  UPDATE public.matches
  SET status = 'COMPLETED'::public.match_status,
      winner_registration_id = p_winner_registration_id,
      updated_at = NOW()
  WHERE id = p_match_id;

  -- Record or Update Match Result
  INSERT INTO public.match_results (
    match_id,
    winner_registration_id,
    decision_type,
    created_at
  ) VALUES (
    p_match_id,
    p_winner_registration_id,
    p_decision_type,
    NOW()
  )
  ON CONFLICT (match_id) DO UPDATE
  SET winner_registration_id = EXCLUDED.winner_registration_id,
      decision_type = EXCLUDED.decision_type;

  -- Update Court Assignment
  IF v_court_id IS NOT NULL THEN
    UPDATE public.court_assignments
    SET status = 'COMPLETED'::public.court_assignment_status,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE match_id = p_match_id AND court_id = v_court_id;
  END IF;

  -- 6. Advance Winner in Single Elimination Bracket Progression
  IF v_match.next_match_id IS NOT NULL AND p_winner_registration_id IS NOT NULL THEN
    SELECT * INTO v_next_match FROM public.matches WHERE id = v_match.next_match_id;
    IF v_next_match.id IS NOT NULL THEN
      IF v_next_match.red_corner_registration_id IS NULL THEN
        UPDATE public.matches SET red_corner_registration_id = p_winner_registration_id, updated_at = NOW() WHERE id = v_next_match.id;
      ELSIF v_next_match.blue_corner_registration_id IS NULL AND v_next_match.red_corner_registration_id <> p_winner_registration_id THEN
        UPDATE public.matches SET blue_corner_registration_id = p_winner_registration_id, updated_at = NOW() WHERE id = v_next_match.id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'match_id', p_match_id,
    'winner_registration_id', p_winner_registration_id,
    'decision_type', p_decision_type,
    'status', 'COMPLETED'
  );
END;
$$;

-- ============================================================================
-- 8. SECURITY GRANTS
-- ============================================================================
REVOKE ALL ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_event_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_event_role(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_match_to_court(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_match_to_court(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.start_court_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_court_match(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.record_round_score(UUID, INT, INT, INT, BOOLEAN, BOOLEAN, public.corner_color, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_round_score(UUID, INT, INT, INT, BOOLEAN, BOOLEAN, public.corner_color, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_court_match(UUID, UUID, public.decision_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_court_match(UUID, UUID, public.decision_type) TO authenticated;
