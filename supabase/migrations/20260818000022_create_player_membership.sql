-- ==============================================================================
-- PATCH-001-P35: PERSISTENT PLAYER MEMBERSHIP ADDITIVE SCHEMA & AUTHORITATIVE RPCs
-- ==============================================================================
-- Sequence: 20260818000022_create_player_membership.sql
-- Description:
--   1. Creates normalized public.club_memberships linking public.profiles to public.clubs.
--   2. Enforces partial unique invariant: Exactly ONE active club membership per player globally.
--   3. Database constraints for valid lifecycle states and membership types.
--   4. RLS security: Blocks direct client REST mutations (INSERT/UPDATE/DELETE).
--   5. Security Definer RPCs with search_path for request, approval, rejection, relief, direct assignment, and roster queries.
--   6. Reuses P32/P33 public.get_coach_team_authority and public.is_super_admin(uuid).
--   7. Enforces strict privilege model: Explicit REVOKE from PUBLIC/anon and targeted GRANT to authenticated.
--   8. Zero modifications or deletions to existing tournament snapshots, seals, or historical data.
-- ==============================================================================

-- 1. Create public.club_memberships Table
CREATE TABLE IF NOT EXISTS public.club_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RELIEVED', 'TRANSFERRED', 'SUSPENDED', 'REJECTED')),
    membership_type TEXT NOT NULL DEFAULT 'REGULAR' CHECK (membership_type IN ('REGULAR', 'STUDENT_ATHLETE', 'VARSITY', 'ALUMNI')),
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Temporal validity constraints
    CONSTRAINT chk_pending_temporal_null CHECK (
        (status = 'PENDING' AND effective_from IS NULL AND effective_to IS NULL) OR
        (status = 'REJECTED' AND effective_from IS NULL AND effective_to IS NULL) OR
        (status = 'ACTIVE' AND effective_from IS NOT NULL AND effective_to IS NULL) OR
        (status IN ('RELIEVED', 'TRANSFERRED', 'SUSPENDED') AND effective_from IS NOT NULL)
    ),
    CONSTRAINT chk_effective_window CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

-- 2. Indexes for Performance and Invariant Protection
-- Unique invariant: Exactly one ACTIVE membership per player globally
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_club_membership_per_player
    ON public.club_memberships (player_user_id)
    WHERE status = 'ACTIVE';

-- Prevent duplicate PENDING request for the same club by the same player
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_pending_membership_per_club_per_player
    ON public.club_memberships (player_user_id, club_id)
    WHERE status = 'PENDING';

-- General lookup indexes
CREATE INDEX IF NOT EXISTS idx_club_memberships_player ON public.club_memberships (player_user_id);
CREATE INDEX IF NOT EXISTS idx_club_memberships_club ON public.club_memberships (club_id);
CREATE INDEX IF NOT EXISTS idx_club_memberships_status ON public.club_memberships (status);
CREATE INDEX IF NOT EXISTS idx_club_memberships_created_at ON public.club_memberships (created_at DESC);

-- 3. Automatic updated_at Trigger
CREATE OR REPLACE FUNCTION public.handle_club_memberships_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_memberships_updated_at ON public.club_memberships;
CREATE TRIGGER trg_club_memberships_updated_at
    BEFORE UPDATE ON public.club_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_club_memberships_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE public.club_memberships ENABLE ROW LEVEL SECURITY;

-- 4.1 SELECT Policies:
-- Transparent authenticated read for ACTIVE, RELIEVED, TRANSFERRED (roster transparency)
DROP POLICY IF EXISTS "Public can view active and historical club rosters" ON public.club_memberships;
CREATE POLICY "Public can view active and historical club rosters"
    ON public.club_memberships
    FOR SELECT
    TO authenticated
    USING (status IN ('ACTIVE', 'RELIEVED', 'TRANSFERRED'));

-- PENDING and REJECTED/SUSPENDED records visible only to the player, authorized club coach, or Super Admin
DROP POLICY IF EXISTS "Requesting player can view own membership records" ON public.club_memberships;
CREATE POLICY "Requesting player can view own membership records"
    ON public.club_memberships
    FOR SELECT
    TO authenticated
    USING (
        player_user_id = auth.uid() OR
        requested_by = auth.uid()
    );

DROP POLICY IF EXISTS "Authorized club coaches can view club membership requests" ON public.club_memberships;
CREATE POLICY "Authorized club coaches can view club membership requests"
    ON public.club_memberships
    FOR SELECT
    TO authenticated
    USING (
        public.get_coach_team_authority(auth.uid(), club_id) OR
        public.is_super_admin(auth.uid())
    );

-- 4.2 Restrict Direct Client REST Mutations (All writes routed through SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Direct client inserts denied on club_memberships" ON public.club_memberships;
CREATE POLICY "Direct client inserts denied on club_memberships"
    ON public.club_memberships
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS "Direct client updates denied on club_memberships" ON public.club_memberships;
CREATE POLICY "Direct client updates denied on club_memberships"
    ON public.club_memberships
    FOR UPDATE
    TO authenticated
    USING (false);

DROP POLICY IF EXISTS "Direct client deletes denied on club_memberships" ON public.club_memberships;
CREATE POLICY "Direct client deletes denied on club_memberships"
    ON public.club_memberships
    FOR DELETE
    TO authenticated
    USING (false);


-- ==============================================================================
-- 5. AUTHORITATIVE SECURITY DEFINER RPCs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- RPC 1: request_player_membership
-- Authenticated player requests membership in a club. State: PENDING.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_player_membership(
    p_club_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_club_exists BOOLEAN;
    v_has_active BOOLEAN;
    v_has_pending BOOLEAN;
    v_new_membership_id UUID;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Verify target club exists and is active
    SELECT EXISTS (
        SELECT 1 FROM public.clubs WHERE id = p_club_id AND is_active = TRUE
    ) INTO v_club_exists;

    IF NOT v_club_exists THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND: Target club does not exist or is inactive' USING ERRCODE = '40400';
    END IF;

    -- Verify caller does not already have an ACTIVE membership globally
    SELECT EXISTS (
        SELECT 1 FROM public.club_memberships 
        WHERE player_user_id = v_caller_id AND status = 'ACTIVE'
    ) INTO v_has_active;

    IF v_has_active THEN
        RAISE EXCEPTION 'ALREADY_ACTIVE_MEMBER: Player already belongs to an active club. Must be relieved first.' USING ERRCODE = '23505';
    END IF;

    -- Verify no duplicate PENDING request for this club
    SELECT EXISTS (
        SELECT 1 FROM public.club_memberships 
        WHERE player_user_id = v_caller_id AND club_id = p_club_id AND status = 'PENDING'
    ) INTO v_has_pending;

    IF v_has_pending THEN
        RAISE EXCEPTION 'DUPLICATE_PENDING: A pending membership request for this club already exists.' USING ERRCODE = '23505';
    END IF;

    -- Insert PENDING membership record
    INSERT INTO public.club_memberships (
        player_user_id,
        club_id,
        status,
        membership_type,
        effective_from,
        effective_to,
        requested_by,
        approved_by,
        reviewed_at,
        review_notes,
        created_at,
        updated_at
    ) VALUES (
        v_caller_id,
        p_club_id,
        'PENDING',
        'REGULAR',
        NULL,
        NULL,
        v_caller_id,
        NULL,
        NULL,
        p_notes,
        v_now,
        v_now
    )
    RETURNING id INTO v_new_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', v_new_membership_id,
        'status', 'PENDING',
        'message', 'Membership request submitted successfully and is awaiting coach review.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 2: approve_player_membership
-- Authorized Club Coach or Super Admin approves a PENDING membership request -> ACTIVE.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_player_membership(
    p_membership_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_membership RECORD;
    v_has_other_active BOOLEAN;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock membership record FOR UPDATE
    SELECT * INTO v_membership
    FROM public.club_memberships
    WHERE id = p_membership_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND: Specified membership record does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_membership.status != 'PENDING' THEN
        RAISE EXCEPTION 'INVALID_STATE: Only PENDING membership requests can be approved' USING ERRCODE = '22000';
    END IF;

    -- Authorization check: Must be active Coach for this club or Super Admin
    IF NOT (public.get_coach_team_authority(v_caller_id, v_membership.club_id) OR public.is_super_admin(v_caller_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for this club' USING ERRCODE = '40300';
    END IF;

    -- Enforce Separation of Duties: Player cannot self-approve their own membership
    IF v_membership.player_user_id = v_caller_id THEN
        RAISE EXCEPTION 'FORBIDDEN: Player cannot self-approve their own club membership request' USING ERRCODE = '40300';
    END IF;

    -- Invariant check: Verify player hasn't activated another membership concurrently
    SELECT EXISTS (
        SELECT 1 FROM public.club_memberships
        WHERE player_user_id = v_membership.player_user_id 
          AND status = 'ACTIVE' 
          AND id != p_membership_id
    ) INTO v_has_other_active;

    IF v_has_other_active THEN
        RAISE EXCEPTION 'CONFLICT_ACTIVE_EXISTS: Player already holds an active club membership' USING ERRCODE = '23505';
    END IF;

    -- Atomic state transition: PENDING -> ACTIVE
    UPDATE public.club_memberships
    SET status = 'ACTIVE',
        effective_from = v_now,
        approved_by = v_caller_id,
        reviewed_at = v_now,
        review_notes = COALESCE(p_notes, review_notes),
        updated_at = v_now
    WHERE id = p_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', p_membership_id,
        'status', 'ACTIVE',
        'effective_from', v_now,
        'message', 'Player membership approved successfully.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 3: reject_player_membership
-- Authorized Club Coach or Super Admin rejects a PENDING membership request -> REJECTED.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_player_membership(
    p_membership_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_membership RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock membership record FOR UPDATE
    SELECT * INTO v_membership
    FROM public.club_memberships
    WHERE id = p_membership_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND: Specified membership record does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_membership.status != 'PENDING' THEN
        RAISE EXCEPTION 'INVALID_STATE: Only PENDING membership requests can be rejected' USING ERRCODE = '22000';
    END IF;

    -- Authorization check: Must be active Coach for this club or Super Admin
    IF NOT (public.get_coach_team_authority(v_caller_id, v_membership.club_id) OR public.is_super_admin(v_caller_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for this club' USING ERRCODE = '40300';
    END IF;

    -- Atomic transition: PENDING -> REJECTED
    UPDATE public.club_memberships
    SET status = 'REJECTED',
        approved_by = v_caller_id,
        reviewed_at = v_now,
        review_notes = COALESCE(p_notes, review_notes),
        updated_at = v_now
    WHERE id = p_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', p_membership_id,
        'status', 'REJECTED',
        'message', 'Player membership request rejected.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 4: relieve_player_membership
-- Relieves an ACTIVE player membership -> RELIEVED.
-- Authorized: Club Coach, Super Admin, or Player self-resignation.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.relieve_player_membership(
    p_membership_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_membership RECORD;
    v_is_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_is_self BOOLEAN;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock membership record FOR UPDATE
    SELECT * INTO v_membership
    FROM public.club_memberships
    WHERE id = p_membership_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND: Specified membership record does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_membership.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_STATE: Only ACTIVE memberships can be relieved' USING ERRCODE = '22000';
    END IF;

    v_is_coach := public.get_coach_team_authority(v_caller_id, v_membership.club_id);
    v_is_admin := public.is_super_admin(v_caller_id);
    v_is_self := (v_caller_id = v_membership.player_user_id);

    IF NOT (v_is_coach OR v_is_admin OR v_is_self) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not authorized to relieve this membership' USING ERRCODE = '40300';
    END IF;

    -- Atomic transition: ACTIVE -> RELIEVED
    UPDATE public.club_memberships
    SET status = 'RELIEVED',
        effective_to = v_now,
        review_notes = CASE 
            WHEN p_reason IS NOT NULL AND review_notes IS NOT NULL THEN review_notes || ' | Relieved: ' || p_reason
            WHEN p_reason IS NOT NULL THEN 'Relieved: ' || p_reason
            ELSE review_notes
        END,
        updated_at = v_now
    WHERE id = p_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', p_membership_id,
        'status', 'RELIEVED',
        'effective_to', v_now,
        'message', 'Player membership successfully relieved.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 5: direct_assign_player_membership
-- Super Admin administrative direct appointment (bypasses PENDING request).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.direct_assign_player_membership(
    p_player_user_id UUID,
    p_club_id UUID,
    p_membership_type TEXT DEFAULT 'REGULAR',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_player_exists BOOLEAN;
    v_club_exists BOOLEAN;
    v_has_active BOOLEAN;
    v_new_membership_id UUID;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    IF NOT public.is_super_admin(v_caller_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Direct player membership assignment is restricted to Super Admins' USING ERRCODE = '40300';
    END IF;

    -- Validate player exists
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_player_user_id) INTO v_player_exists;
    IF NOT v_player_exists THEN
        RAISE EXCEPTION 'PLAYER_NOT_FOUND: Specified player profile does not exist' USING ERRCODE = '40400';
    END IF;

    -- Validate club exists
    SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id AND is_active = TRUE) INTO v_club_exists;
    IF NOT v_club_exists THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND: Specified club does not exist or is inactive' USING ERRCODE = '40400';
    END IF;

    -- Validate membership type
    IF p_membership_type NOT IN ('REGULAR', 'STUDENT_ATHLETE', 'VARSITY', 'ALUMNI') THEN
        RAISE EXCEPTION 'INVALID_MEMBERSHIP_TYPE: Allowed types are REGULAR, STUDENT_ATHLETE, VARSITY, ALUMNI' USING ERRCODE = '22023';
    END IF;

    -- Check if player already has active membership
    SELECT EXISTS (
        SELECT 1 FROM public.club_memberships WHERE player_user_id = p_player_user_id AND status = 'ACTIVE'
    ) INTO v_has_active;

    IF v_has_active THEN
        RAISE EXCEPTION 'ALREADY_ACTIVE_MEMBER: Player already holds an active club membership. Relieve it first.' USING ERRCODE = '23505';
    END IF;

    -- If there was a PENDING request for this club, relieve or clean it up
    UPDATE public.club_memberships
    SET status = 'REJECTED',
        review_notes = 'Superseded by direct Super Admin assignment',
        updated_at = v_now
    WHERE player_user_id = p_player_user_id AND club_id = p_club_id AND status = 'PENDING';

    -- Insert direct ACTIVE record
    INSERT INTO public.club_memberships (
        player_user_id,
        club_id,
        status,
        membership_type,
        effective_from,
        effective_to,
        requested_by,
        approved_by,
        reviewed_at,
        review_notes,
        created_at,
        updated_at
    ) VALUES (
        p_player_user_id,
        p_club_id,
        'ACTIVE',
        p_membership_type,
        v_now,
        NULL,
        v_caller_id,
        v_caller_id,
        v_now,
        p_notes,
        v_now,
        v_now
    )
    RETURNING id INTO v_new_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', v_new_membership_id,
        'status', 'ACTIVE',
        'effective_from', v_now,
        'message', 'Player membership directly assigned and activated by Super Admin.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 6: get_player_active_membership
-- Authenticated safe lookup of a player's active club membership.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_player_active_membership(
    p_player_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_result JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    SELECT jsonb_build_object(
        'membership_id', cm.id,
        'player_user_id', cm.player_user_id,
        'club_id', cm.club_id,
        'club_name', c.name,
        'club_code', c.code,
        'club_logo_url', c.logo_url,
        'status', cm.status,
        'membership_type', cm.membership_type,
        'effective_from', cm.effective_from,
        'created_at', cm.created_at
    ) INTO v_result
    FROM public.club_memberships cm
    JOIN public.clubs c ON c.id = cm.club_id
    WHERE cm.player_user_id = p_player_user_id
      AND cm.status = 'ACTIVE'
    LIMIT 1;

    RETURN COALESCE(v_result, 'null'::jsonb);
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 7: get_club_member_roster
-- Queries roster for a club with authorized access controls.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_club_member_roster(
    p_club_id UUID,
    p_status_filter TEXT DEFAULT 'ACTIVE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_roster JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    v_is_coach := public.get_coach_team_authority(v_caller_id, p_club_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    -- If requesting non-ACTIVE records (e.g. PENDING requests), restrict to Coach or Admin
    IF p_status_filter IN ('PENDING', 'SUSPENDED', 'REJECTED') AND NOT (v_is_coach OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Viewing pending or administrative membership requests requires club coach or admin privileges' USING ERRCODE = '40300';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'membership_id', cm.id,
            'player_user_id', cm.player_user_id,
            'full_name', p.full_name,
            'email', CASE WHEN (v_is_coach OR v_is_admin) THEN p.email ELSE NULL END,
            'club_id', cm.club_id,
            'status', cm.status,
            'membership_type', cm.membership_type,
            'effective_from', cm.effective_from,
            'effective_to', cm.effective_to,
            'requested_by', cm.requested_by,
            'approved_by', cm.approved_by,
            'reviewed_at', cm.reviewed_at,
            'review_notes', CASE WHEN (v_is_coach OR v_is_admin) THEN cm.review_notes ELSE NULL END,
            'created_at', cm.created_at
        ) ORDER BY cm.effective_from DESC NULLS LAST, cm.created_at DESC
    ) INTO v_roster
    FROM public.club_memberships cm
    JOIN public.profiles p ON p.id = cm.player_user_id
    WHERE cm.club_id = p_club_id
      AND (p_status_filter IS NULL OR p_status_filter = 'ALL' OR cm.status = p_status_filter);

    RETURN COALESCE(v_roster, '[]'::jsonb);
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 8: get_player_membership_history
-- Returns chronological club membership history for an athlete.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_player_membership_history(
    p_player_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_self BOOLEAN;
    v_is_admin BOOLEAN;
    v_history JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    v_is_self := (v_caller_id = p_player_user_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    SELECT jsonb_agg(
        jsonb_build_object(
            'membership_id', cm.id,
            'player_user_id', cm.player_user_id,
            'club_id', cm.club_id,
            'club_name', c.name,
            'club_code', c.code,
            'club_logo_url', c.logo_url,
            'status', cm.status,
            'membership_type', cm.membership_type,
            'effective_from', cm.effective_from,
            'effective_to', cm.effective_to,
            'created_at', cm.created_at
        ) ORDER BY cm.effective_from DESC NULLS LAST, cm.created_at DESC
    ) INTO v_history
    FROM public.club_memberships cm
    JOIN public.clubs c ON c.id = cm.club_id
    WHERE cm.player_user_id = p_player_user_id
      AND (cm.status IN ('ACTIVE', 'RELIEVED', 'TRANSFERRED') OR v_is_self OR v_is_admin);

    RETURN COALESCE(v_history, '[]'::jsonb);
END;
$$;


-- ==============================================================================
-- 6. PRIVILEGE MANAGEMENT & HARDENING
-- ==============================================================================

-- 6.1 Revoke default PUBLIC and anon execution from all functions
REVOKE EXECUTE ON FUNCTION public.handle_club_memberships_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_club_memberships_updated_at() FROM anon;

REVOKE EXECUTE ON FUNCTION public.request_player_membership(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_player_membership(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.approve_player_membership(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_player_membership(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.reject_player_membership(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_player_membership(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.relieve_player_membership(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.relieve_player_membership(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.direct_assign_player_membership(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.direct_assign_player_membership(UUID, UUID, TEXT, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_player_active_membership(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_player_active_membership(UUID) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_club_member_roster(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_member_roster(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_player_membership_history(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_player_membership_history(UUID) FROM anon;

-- 6.2 Explicitly grant table permissions & function execution strictly to authenticated role
GRANT SELECT ON public.club_memberships TO authenticated;

GRANT EXECUTE ON FUNCTION public.request_player_membership(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_player_membership(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_player_membership(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relieve_player_membership(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.direct_assign_player_membership(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_active_membership(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_member_roster(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_membership_history(UUID) TO authenticated;
