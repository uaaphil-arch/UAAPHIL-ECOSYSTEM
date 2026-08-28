-- Migration: 20260828000060_reconcile_assign_event_role_operational_rbac.sql
-- Patch ID: PATCH-P22.6-RECONCILE-ASSIGN-EVENT-ROLE-RBAC
-- Description: Reconcile public.assign_event_role operational RBAC and decouple candidate qualification from global app_role

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

  -- 3. Check Target User Status (Active Profile Qualification)
  SELECT p.status
  INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Target user profile does not exist.' USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Target official account is not active.' USING ERRCODE = '40001';
  END IF;

  -- 4. Resolve Tournament and Event Ownership
  SELECT ts.tournament_id, t.organizer_id
  INTO v_resolved_tournament_id, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_resolved_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event does not exist or has no valid tournament.' USING ERRCODE = '40400';
  END IF;

  -- 5. Validate Role-Specific Court Constraints
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

  -- 6. Verify Requester Authority
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

  -- 7. Single Active COURT_MANAGER Invariant
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

  -- 8. Safe Look-up / Reactivation or Insertion (No invalid ON CONFLICT targets)
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
    v_requester_id,
    CASE 
      WHEN v_is_super_admin THEN 'SUPER_ADMIN'
      WHEN v_is_admin THEN 'ADMIN'
      WHEN v_is_organizer THEN 'ORGANIZER'
      ELSE 'COURT_MANAGER'
    END,
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
GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, public.event_role, UUID) TO service_role;
