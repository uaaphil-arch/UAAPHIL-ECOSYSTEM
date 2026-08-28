-- ==============================================================================
-- PATCH MIGRATION: 20260818000024_harden_club_and_coach_security.sql
-- Domain: Club & Coach Succession Security Hardening
-- Project: UAAPHIL Tournament System
-- Target: Supabase / PostgreSQL 15+
-- Sequence: 000024 (Additive, Non-destructive)
-- Applies strictly AFTER: 20260818000021_create_club_and_coach_succession.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDEN: approve_coach_succession
-- Enforces self-approval prohibition (incoming coach cannot approve own succession)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_coach_succession(
  p_request_id UUID,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_request RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_new_assignment_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Super Admin Authorization check
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Super Admins can approve coach succession requests'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Lock and retrieve succession request
  SELECT * INTO v_request
  FROM public.coach_succession_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: Succession request does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only PENDING succession requests can be approved'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Enforce Self-Approval Prohibition
  IF v_request.incoming_coach_id = v_requester_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Incoming coach cannot self-approve their own succession request'
      USING ERRCODE = '40300';
  END IF;

  -- 5. Atomic state transitions
  -- 5a. Relieve existing active coach for this club and role
  UPDATE public.club_coaches
  SET 
    status = 'RELIEVED',
    effective_to = v_now,
    relieved_by = v_requester_id,
    updated_at = v_now
  WHERE club_id = v_request.club_id 
    AND role_type = v_request.role_type 
    AND status = 'ACTIVE';

  -- 5b. Insert new active coach record
  INSERT INTO public.club_coaches (
    club_id,
    coach_user_id,
    role_type,
    status,
    effective_from,
    appointed_by,
    notes
  ) VALUES (
    v_request.club_id,
    v_request.incoming_coach_id,
    v_request.role_type,
    'ACTIVE',
    v_now,
    v_requester_id,
    'Approved via succession request ' || p_request_id::TEXT
  )
  RETURNING id INTO v_new_assignment_id;

  -- 5c. Ensure incoming coach possesses COACH role in user_roles
  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (v_request.incoming_coach_id, 'COACH', v_requester_id)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 5d. Mark succession request as APPROVED
  UPDATE public.coach_succession_requests
  SET 
    status = 'APPROVED',
    reviewed_by = v_requester_id,
    reviewed_at = v_now,
    review_notes = p_review_notes,
    updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'APPROVED',
    'request_id', p_request_id,
    'assignment_id', v_new_assignment_id,
    'club_id', v_request.club_id,
    'outgoing_coach_id', v_request.outgoing_coach_id,
    'incoming_coach_id', v_request.incoming_coach_id,
    'approved_at', v_now
  );
END;
$$;


-- ------------------------------------------------------------------------------
-- 2. HARDEN: get_pending_coach_successions
-- Enforces internal administrative caller validation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_coach_successions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id UUID;
  v_is_admin BOOLEAN;
  v_requests JSONB;
BEGIN
  -- 1. Identify and authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate administrative authority (SUPER_ADMIN or ADMIN)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_caller_id AND role IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Super Admins or Admins can view pending coach successions'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Retrieve pending succession requests
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', csr.id,
      'club_id', csr.club_id,
      'club_name', c.name,
      'club_code', c.code,
      'outgoing_coach_id', csr.outgoing_coach_id,
      'outgoing_coach_name', outgoing.full_name,
      'incoming_coach_id', csr.incoming_coach_id,
      'incoming_coach_name', incoming.full_name,
      'incoming_coach_email', incoming.email,
      'role_type', csr.role_type,
      'status', csr.status,
      'reason', csr.reason,
      'requested_by_id', csr.requested_by,
      'requested_by_name', requester.full_name,
      'created_at', csr.created_at
    ) ORDER BY csr.created_at DESC
  ) INTO v_requests
  FROM public.coach_succession_requests csr
  JOIN public.clubs c ON c.id = csr.club_id
  JOIN public.profiles incoming ON incoming.id = csr.incoming_coach_id
  JOIN public.profiles requester ON requester.id = csr.requested_by
  LEFT JOIN public.profiles outgoing ON outgoing.id = csr.outgoing_coach_id
  WHERE csr.status = 'PENDING';

  RETURN COALESCE(v_requests, '[]'::JSONB);
END;
$$;


-- ------------------------------------------------------------------------------
-- 3. REVOKE DEFAULT PUBLIC AND UNINTENDED ANON PRIVILEGES
-- ------------------------------------------------------------------------------

-- 3a. get_coach_team_authority
REVOKE EXECUTE ON FUNCTION public.get_coach_team_authority(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_coach_team_authority(UUID, UUID) FROM anon;

-- 3b. request_coach_succession
REVOKE EXECUTE ON FUNCTION public.request_coach_succession(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_coach_succession(UUID, UUID, TEXT, TEXT) FROM anon;

-- 3c. approve_coach_succession
REVOKE EXECUTE ON FUNCTION public.approve_coach_succession(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_coach_succession(UUID, TEXT) FROM anon;

-- 3d. reject_coach_succession
REVOKE EXECUTE ON FUNCTION public.reject_coach_succession(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_coach_succession(UUID, TEXT) FROM anon;

-- 3e. direct_assign_club_coach
REVOKE EXECUTE ON FUNCTION public.direct_assign_club_coach(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.direct_assign_club_coach(UUID, UUID, TEXT, TEXT) FROM anon;

-- 3f. create_club
REVOKE EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) FROM anon;

-- 3g. get_pending_coach_successions
REVOKE EXECUTE ON FUNCTION public.get_pending_coach_successions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_coach_successions() FROM anon;

-- 3h. get_club_active_coach
REVOKE EXECUTE ON FUNCTION public.get_club_active_coach(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_active_coach(UUID) FROM anon;

-- 3i. get_club_coach_history
REVOKE EXECUTE ON FUNCTION public.get_club_coach_history(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_coach_history(UUID) FROM anon;


-- ------------------------------------------------------------------------------
-- 4. EXPLICITLY GRANT EXECUTE ONLY TO AUTHENTICATED ROLE
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_coach_team_authority(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_coach_succession(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_coach_succession(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_coach_succession(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.direct_assign_club_coach(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_coach_successions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_active_coach(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_coach_history(UUID) TO authenticated;
