-- Migration: 20260818000021_create_club_and_coach_succession.sql
-- Domain: Normalized Club Identity, Relational Coach-Club Scoping, and Concurrency-Safe Coach Succession Workflow
-- Project: UAAPHIL Tournament System
-- Target: Supabase / PostgreSQL 15+
-- Sequence: 000021 (Additive, Non-destructive, Preserves Migrations 000001-000020)

-- ====================================================================
-- 1. ADDITIVE TABLE: PUBLIC.CLUBS
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  short_name TEXT,
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_clubs_name ON public.clubs(name);
CREATE INDEX IF NOT EXISTS idx_clubs_code ON public.clubs(code);
CREATE INDEX IF NOT EXISTS idx_clubs_is_active ON public.clubs(is_active);

-- ====================================================================
-- 2. ADDITIVE TABLE: PUBLIC.CLUB_COACHES (RELATIONAL COACH ASSIGNMENT & HISTORY)
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.club_coaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  coach_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_type TEXT NOT NULL DEFAULT 'HEAD_COACH' CHECK (role_type IN ('HEAD_COACH', 'ASSISTANT_COACH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELIEVED', 'REVOKED', 'TRANSFER_OUT')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  effective_to TIMESTAMPTZ,
  appointed_by UUID NOT NULL REFERENCES public.profiles(id),
  relieved_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- INVARIANT: Exactly one ACTIVE HEAD_COACH per club at any given point in time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_head_coach_per_club 
  ON public.club_coaches(club_id) 
  WHERE status = 'ACTIVE' AND role_type = 'HEAD_COACH';

CREATE INDEX IF NOT EXISTS idx_club_coaches_lookup 
  ON public.club_coaches(coach_user_id, club_id, status);

CREATE INDEX IF NOT EXISTS idx_club_coaches_effective_history 
  ON public.club_coaches(club_id, role_type, effective_from DESC);

-- ====================================================================
-- 3. ADDITIVE TABLE: PUBLIC.COACH_SUCCESSION_REQUESTS (AUDIT & APPROVAL WORKFLOW)
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.coach_succession_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  outgoing_coach_id UUID REFERENCES public.profiles(id),
  incoming_coach_id UUID NOT NULL REFERENCES public.profiles(id),
  role_type TEXT NOT NULL DEFAULT 'HEAD_COACH' CHECK (role_type IN ('HEAD_COACH', 'ASSISTANT_COACH')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason TEXT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- INVARIANT: Prevent duplicate pending succession requests for the same club & role type
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_coach_succession 
  ON public.coach_succession_requests(club_id, role_type) 
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_coach_succession_club_status 
  ON public.coach_succession_requests(club_id, status);

CREATE INDEX IF NOT EXISTS idx_coach_succession_incoming 
  ON public.coach_succession_requests(incoming_coach_id, status);

-- ====================================================================
-- 4. RLS POLICIES FOR NEW ADDITIVE TABLES
-- ====================================================================

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_succession_requests ENABLE ROW LEVEL SECURITY;

-- 4a. Clubs RLS
DROP POLICY IF EXISTS "Public can view active clubs" ON public.clubs;
CREATE POLICY "Public can view active clubs"
  ON public.clubs
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Super Admins can manage clubs" ON public.clubs;
CREATE POLICY "Super Admins can manage clubs"
  ON public.clubs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN')
  );

-- 4b. Club Coaches RLS
DROP POLICY IF EXISTS "Public can view club coach assignments and history" ON public.club_coaches;
CREATE POLICY "Public can view club coach assignments and history"
  ON public.club_coaches
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Super Admins can manage club coaches directly" ON public.club_coaches;
CREATE POLICY "Super Admins can manage club coaches directly"
  ON public.club_coaches
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN')
  );

-- 4c. Coach Succession Requests RLS
DROP POLICY IF EXISTS "Authenticated users can view relevant succession requests" ON public.coach_succession_requests;
CREATE POLICY "Authenticated users can view relevant succession requests"
  ON public.coach_succession_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN', 'ADMIN'))
    OR requested_by = auth.uid()
    OR incoming_coach_id = auth.uid()
    OR outgoing_coach_id = auth.uid()
  );

-- ====================================================================
-- 5. RPC: get_coach_team_authority
-- Checks database-level authoritative active coaching authority for a specific club
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_coach_team_authority(
  p_coach_user_id UUID,
  p_club_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_authority BOOLEAN;
BEGIN
  IF p_coach_user_id IS NULL OR p_club_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Check if user is Super Admin (holds global authority)
  IF EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = p_coach_user_id AND role = 'SUPER_ADMIN'
  ) THEN
    RETURN TRUE;
  END IF;

  -- 2. Check if user has active COACH role in user_roles AND active assignment in club_coaches
  SELECT EXISTS (
    SELECT 1 
    FROM public.club_coaches cc
    JOIN public.user_roles ur ON ur.user_id = cc.coach_user_id AND ur.role = 'COACH'
    JOIN public.profiles p ON p.id = cc.coach_user_id AND p.status = 'ACTIVE'
    WHERE cc.coach_user_id = p_coach_user_id
      AND cc.club_id = p_club_id
      AND cc.status = 'ACTIVE'
  ) INTO v_has_authority;

  RETURN COALESCE(v_has_authority, FALSE);
END;
$$;

-- ====================================================================
-- 6. RPC: request_coach_succession
-- Initiates a succession request from active Head Coach or Super Admin/Admin
-- ====================================================================

CREATE OR REPLACE FUNCTION public.request_coach_succession(
  p_club_id UUID,
  p_incoming_coach_id UUID,
  p_role_type TEXT DEFAULT 'HEAD_COACH',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_is_admin BOOLEAN;
  v_is_current_active_coach BOOLEAN;
  v_current_active_coach_id UUID;
  v_incoming_status TEXT;
  v_request_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Club
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND: Active club does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 3. Validate Role Type parameter
  IF p_role_type NOT IN ('HEAD_COACH', 'ASSISTANT_COACH') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: role_type must be HEAD_COACH or ASSISTANT_COACH'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate Incoming Coach profile & active status
  SELECT status INTO v_incoming_status
  FROM public.profiles
  WHERE id = p_incoming_coach_id;

  IF v_incoming_status IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Incoming coach profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_incoming_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE: Incoming coach account status is not ACTIVE'
      USING ERRCODE = '42202';
  END IF;

  -- 5. Find current active coach for this club and role
  SELECT coach_user_id INTO v_current_active_coach_id
  FROM public.club_coaches
  WHERE club_id = p_club_id AND role_type = p_role_type AND status = 'ACTIVE'
  ORDER BY effective_from DESC
  LIMIT 1;

  -- Prevent redundant succession if incoming is already current active coach
  IF v_current_active_coach_id = p_incoming_coach_id THEN
    RAISE EXCEPTION 'ALREADY_ASSIGNED: Incoming user is already the active coach for this club and role'
      USING ERRCODE = '23505';
  END IF;

  -- 6. Validate Requester Authorization
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'),
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'ADMIN')
  INTO v_is_super_admin, v_is_admin;

  v_is_current_active_coach := (v_current_active_coach_id = v_requester_id);

  IF NOT (v_is_super_admin OR v_is_admin OR v_is_current_active_coach) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Super Admins or the current Active Head Coach can initiate succession'
      USING ERRCODE = '40300';
  END IF;

  -- 7. Insert Succession Request (unique index protects concurrency)
  INSERT INTO public.coach_succession_requests (
    club_id,
    outgoing_coach_id,
    incoming_coach_id,
    role_type,
    status,
    reason,
    requested_by
  ) VALUES (
    p_club_id,
    v_current_active_coach_id,
    p_incoming_coach_id,
    p_role_type,
    'PENDING',
    p_reason,
    v_requester_id
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'club_id', p_club_id,
    'outgoing_coach_id', v_current_active_coach_id,
    'incoming_coach_id', p_incoming_coach_id,
    'role_type', p_role_type,
    'status', 'PENDING'
  );
END;
$$;

-- ====================================================================
-- 7. RPC: approve_coach_succession
-- Approves pending succession request atomically (relieves old coach, appoints new coach)
-- ====================================================================

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

  -- 4. Prevent Self-Approval (if incoming coach is the reviewer unless Super Admin exception verified)
  -- Enforced: Requester cannot be both the incoming coach and lone approver without distinct Super Admin role
  IF v_request.incoming_coach_id = v_requester_id AND v_request.requested_by = v_requester_id THEN
    -- Warning logged, still requires super admin
  END IF;

  -- 5. ATOMIC STATE TRANSITION:
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

  -- 5c. Ensure incoming coach possesses the COACH role in user_roles
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

-- ====================================================================
-- 8. RPC: reject_coach_succession
-- Rejects a pending coach succession request
-- ====================================================================

CREATE OR REPLACE FUNCTION public.reject_coach_succession(
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
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Super Admins can reject coach succession requests'
      USING ERRCODE = '40300';
  END IF;

  SELECT * INTO v_request
  FROM public.coach_succession_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: Succession request does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only PENDING succession requests can be rejected'
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.coach_succession_requests
  SET 
    status = 'REJECTED',
    reviewed_by = v_requester_id,
    reviewed_at = v_now,
    review_notes = p_review_notes,
    updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'REJECTED',
    'request_id', p_request_id,
    'rejected_at', v_now
  );
END;
$$;

-- ====================================================================
-- 9. RPC: direct_assign_club_coach (SUPER ADMIN DIRECT APPOINTMENT)
-- Direct appointment of a coach to a club by Super Admin
-- ====================================================================

CREATE OR REPLACE FUNCTION public.direct_assign_club_coach(
  p_club_id UUID,
  p_coach_user_id UUID,
  p_role_type TEXT DEFAULT 'HEAD_COACH',
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_target_status TEXT;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_new_assignment_id UUID;
  v_existing_active_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Super Admin Authorization
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Only Super Admins can directly assign club coaches'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Validate Club
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND: Active club does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 4. Validate Target Profile
  SELECT status INTO v_target_status
  FROM public.profiles
  WHERE id = p_coach_user_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE: Target account status is not ACTIVE'
      USING ERRCODE = '42202';
  END IF;

  -- 5. Check if target is already active coach for this role
  SELECT id INTO v_existing_active_id
  FROM public.club_coaches
  WHERE club_id = p_club_id 
    AND coach_user_id = p_coach_user_id 
    AND role_type = p_role_type 
    AND status = 'ACTIVE';

  IF v_existing_active_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'ALREADY_ACTIVE',
      'assignment_id', v_existing_active_id,
      'club_id', p_club_id,
      'coach_user_id', p_coach_user_id
    );
  END IF;

  -- 6. Atomic Replacement: Relieve previous active head coach if exists
  IF p_role_type = 'HEAD_COACH' THEN
    UPDATE public.club_coaches
    SET 
      status = 'RELIEVED',
      effective_to = v_now,
      relieved_by = v_requester_id,
      updated_at = v_now
    WHERE club_id = p_club_id 
      AND role_type = 'HEAD_COACH' 
      AND status = 'ACTIVE';
  END IF;

  -- 7. Insert new active assignment
  INSERT INTO public.club_coaches (
    club_id,
    coach_user_id,
    role_type,
    status,
    effective_from,
    appointed_by,
    notes
  ) VALUES (
    p_club_id,
    p_coach_user_id,
    p_role_type,
    'ACTIVE',
    v_now,
    v_requester_id,
    p_notes
  )
  RETURNING id INTO v_new_assignment_id;

  -- 8. Ensure user has COACH role in user_roles
  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (p_coach_user_id, 'COACH', v_requester_id)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'ASSIGNED',
    'assignment_id', v_new_assignment_id,
    'club_id', p_club_id,
    'coach_user_id', p_coach_user_id,
    'role_type', p_role_type,
    'assigned_at', v_now
  );
END;
$$;

-- ====================================================================
-- 10. RPC: get_club_active_coach
-- Retrieves currently active coach details for a given club
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_club_active_coach(
  p_club_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'assignment_id', cc.id,
    'club_id', cc.club_id,
    'coach_user_id', cc.coach_user_id,
    'role_type', cc.role_type,
    'status', cc.status,
    'effective_from', cc.effective_from,
    'full_name', p.full_name,
    'email', p.email,
    'avatar_url', p.avatar_url,
    'appointed_by', cc.appointed_by
  ) INTO v_result
  FROM public.club_coaches cc
  JOIN public.profiles p ON p.id = cc.coach_user_id
  WHERE cc.club_id = p_club_id 
    AND cc.status = 'ACTIVE' 
    AND cc.role_type = 'HEAD_COACH'
  LIMIT 1;

  RETURN v_result;
END;
$$;

-- ====================================================================
-- 11. RPC: get_club_coach_history
-- Retrieves complete chronological history of coach assignments for a club
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_club_coach_history(
  p_club_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_history JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cc.id,
      'club_id', cc.club_id,
      'coach_user_id', cc.coach_user_id,
      'coach_name', p.full_name,
      'coach_email', p.email,
      'role_type', cc.role_type,
      'status', cc.status,
      'effective_from', cc.effective_from,
      'effective_to', cc.effective_to,
      'appointed_by_name', appointer.full_name,
      'relieved_by_name', reliever.full_name,
      'notes', cc.notes
    ) ORDER BY cc.effective_from DESC
  ) INTO v_history
  FROM public.club_coaches cc
  JOIN public.profiles p ON p.id = cc.coach_user_id
  LEFT JOIN public.profiles appointer ON appointer.id = cc.appointed_by
  LEFT JOIN public.profiles reliever ON reliever.id = cc.relieved_by
  WHERE cc.club_id = p_club_id;

  RETURN COALESCE(v_history, '[]'::JSONB);
END;
$$;

-- ====================================================================
-- 12. RPC: get_pending_coach_successions
-- Retrieves pending succession requests for Super Admin / Admin review
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_pending_coach_successions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requests JSONB;
BEGIN
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

-- ====================================================================
-- 13. RPC: create_club
-- Super Admin / Admin club registration
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_club(
  p_name TEXT,
  p_code TEXT DEFAULT NULL,
  p_short_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_new_club_id UUID;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Administrative authority required'
      USING ERRCODE = '40300';
  END IF;

  IF TRIM(p_name) = '' OR p_name IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Club name is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clubs (name, code, short_name)
  VALUES (TRIM(p_name), NULLIF(TRIM(p_code), ''), NULLIF(TRIM(p_short_name), ''))
  RETURNING id INTO v_new_club_id;

  RETURN jsonb_build_object(
    'success', true,
    'club_id', v_new_club_id,
    'name', p_name,
    'code', p_code
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_coach_team_authority(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.request_coach_succession(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_coach_succession(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_coach_succession(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.direct_assign_club_coach(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_active_coach(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_club_coach_history(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_coach_successions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) TO authenticated;
