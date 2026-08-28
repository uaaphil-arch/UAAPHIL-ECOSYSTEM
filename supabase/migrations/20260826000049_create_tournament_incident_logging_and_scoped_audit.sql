-- Migration: 20260826000049_create_tournament_incident_logging_and_scoped_audit.sql
-- Description: Implement operational incident logging and tournament-scoped audit log retrieval RPCs
--
-- P4 GOVERNANCE SPECIFICATION:
-- 1. log_tournament_incident: Authoritative server-side RPC allowing authorized tournament officials
--    (Super Admin, Admin, Tournament Owner, Event Court Manager, Table Official) to record structured
--    operational incidents with action, severity, entity context, and notes.
-- 2. get_tournament_incident_logs: Authoritative server-side RPC allowing tournament officials to view
--    incident audit records scoped strictly to their authorized tournament, without granting unrestricted
--    global SELECT permissions on public.system_audit_logs to non-super-admins.
-- 3. Security Invariants:
--    - Server-side authorization checks using auth.uid() and account status.
--    - Anonymous and unauthorized callers are strictly rejected with 40100 / 40300.
--    - Cross-tournament audit leakage is strictly prevented.
--    - search_path is anchored strictly to 'public'.

-- -----------------------------------------------------------------------------
-- 0. Safe drop existing function definitions to prevent 42P13 / signature conflicts
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.log_tournament_incident(UUID, TEXT, TEXT, TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.get_tournament_incident_logs(UUID, INT);

-- -----------------------------------------------------------------------------
-- 1. Helper Function: public.is_authorized_tournament_incident_actor
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_authorized_tournament_incident_actor(
  p_user_id UUID,
  p_tournament_id UUID,
  OUT p_is_authorized BOOLEAN,
  OUT p_resolved_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_account_status public.account_status;
  v_organizer_id UUID;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_event_assignment_role public.event_role;
BEGIN
  p_is_authorized := FALSE;
  p_resolved_role := 'ANONYMOUS';

  IF p_user_id IS NULL OR p_tournament_id IS NULL THEN
    RETURN;
  END IF;

  -- 1. Validate User Account Status
  SELECT p.account_status
  INTO v_user_account_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_user_account_status IS NULL OR v_user_account_status <> 'ACTIVE'::public.account_status THEN
    RETURN;
  END IF;

  -- 2. Check Permanent Super Admin / Admin Roles
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF v_is_super_admin THEN
    p_is_authorized := TRUE;
    p_resolved_role := 'SUPER_ADMIN';
    RETURN;
  END IF;

  IF v_is_admin THEN
    p_is_authorized := TRUE;
    p_resolved_role := 'ADMIN';
    RETURN;
  END IF;

  -- 3. Check Tournament Owner (Organizer)
  SELECT t.organizer_id
  INTO v_organizer_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;

  IF v_organizer_id IS NOT NULL AND v_organizer_id = p_user_id THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = p_user_id AND ur.role IN ('ORGANIZER'::public.app_role, 'ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role)
    ) THEN
      p_is_authorized := TRUE;
      p_resolved_role := 'ORGANIZER';
      RETURN;
    END IF;
  END IF;

  -- 4. Check Active Event Assignments (COURT_MANAGER or TABLE_OFFICIAL in this tournament)
  SELECT ea.role
  INTO v_event_assignment_role
  FROM public.event_assignments ea
  JOIN public.events e ON e.id = ea.event_id
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE ts.tournament_id = p_tournament_id
    AND ea.user_id = p_user_id
    AND ea.is_active = TRUE
  ORDER BY 
    CASE WHEN ea.role = 'COURT_MANAGER'::public.event_role THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_event_assignment_role IS NOT NULL THEN
    p_is_authorized := TRUE;
    p_resolved_role := v_event_assignment_role::TEXT;
    RETURN;
  END IF;

  -- Default Deny
  p_is_authorized := FALSE;
  p_resolved_role := 'UNAUTHORIZED';
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. RPC: public.log_tournament_incident
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_tournament_incident(
  p_tournament_id UUID,
  p_action TEXT,
  p_severity TEXT DEFAULT 'WARNING',
  p_entity_type TEXT DEFAULT 'INCIDENT',
  p_entity_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_resolved_role TEXT;
  v_log_id UUID;
  v_normalized_severity TEXT;
  v_merged_details JSONB;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Tournament Existence
  IF p_tournament_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Validate Input Parameters
  IF p_action IS NULL OR TRIM(p_action) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Action description is required.' USING ERRCODE = '40001';
  END IF;

  v_normalized_severity := UPPER(COALESCE(TRIM(p_severity), 'WARNING'));
  IF v_normalized_severity NOT IN ('CRITICAL', 'WARNING', 'INFO', 'LOW', 'MEDIUM', 'HIGH') THEN
    v_normalized_severity := 'WARNING';
  END IF;

  -- 4. Verify Requester Operational Authorization for this Tournament
  SELECT is_auth, role_name
  INTO v_is_authorized, v_resolved_role
  FROM public.is_authorized_tournament_incident_actor(v_requester_id, p_tournament_id) AS (is_auth BOOLEAN, role_name TEXT);

  IF NOT COALESCE(v_is_authorized, FALSE) THEN
    RAISE EXCEPTION 'FORBIDDEN: You do not possess operational authorization to log incidents for this tournament.' USING ERRCODE = '40300';
  END IF;

  -- 5. Merge Details with Metadata
  v_merged_details := COALESCE(p_details, '{}'::jsonb) || jsonb_build_object(
    'severity', v_normalized_severity,
    'logged_at', NOW(),
    'reported_by_role', v_resolved_role
  );

  -- 6. Insert Into Append-Only system_audit_logs
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
    v_resolved_role,
    TRIM(p_action),
    COALESCE(NULLIF(TRIM(p_entity_type), ''), 'INCIDENT'),
    p_entity_id,
    p_tournament_id,
    v_merged_details,
    NOW()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'log_id', v_log_id,
    'tournament_id', p_tournament_id,
    'action', TRIM(p_action),
    'severity', v_normalized_severity,
    'actor_role', v_resolved_role,
    'created_at', NOW()
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. RPC: public.get_tournament_incident_logs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tournament_incident_logs(
  p_tournament_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id UUID,
  tournament_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ,
  actor_name TEXT,
  actor_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID;
  v_is_authorized BOOLEAN := FALSE;
  v_resolved_role TEXT;
  v_effective_limit INT;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Tournament Existence
  IF p_tournament_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament does not exist.' USING ERRCODE = '40400';
  END IF;

  -- 3. Verify Requester Operational Authorization for this Tournament
  SELECT is_auth, role_name
  INTO v_is_authorized, v_resolved_role
  FROM public.is_authorized_tournament_incident_actor(v_requester_id, p_tournament_id) AS (is_auth BOOLEAN, role_name TEXT);

  IF NOT COALESCE(v_is_authorized, FALSE) THEN
    RAISE EXCEPTION 'FORBIDDEN: You do not possess authorization to view incident audit logs for this tournament.' USING ERRCODE = '40300';
  END IF;

  -- 4. Bound Limit
  v_effective_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  -- 5. Return Tournament-Scoped Audit Log Records
  RETURN QUERY
  SELECT 
    sal.id,
    sal.actor_user_id,
    sal.actor_role,
    sal.action,
    sal.entity_type,
    sal.entity_id,
    sal.tournament_id,
    sal.details,
    sal.ip_address,
    sal.created_at,
    p.full_name AS actor_name,
    p.email AS actor_email
  FROM public.system_audit_logs sal
  LEFT JOIN public.profiles p ON p.id = sal.actor_user_id
  WHERE sal.tournament_id = p_tournament_id
  ORDER BY sal.created_at DESC
  LIMIT v_effective_limit;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Security Grants & Access Control
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_authorized_tournament_incident_actor(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_tournament_incident_actor(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.log_tournament_incident(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_tournament_incident(UUID, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.get_tournament_incident_logs(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_incident_logs(UUID, INT) TO authenticated;
