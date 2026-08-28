-- ==============================================================================
-- PATCH-001-P36: PLAYER TRANSFER ADDITIVE SCHEMA & AUTHORITATIVE ATOMIC RPCs
-- ==============================================================================
-- Sequence: 20260818000023_create_player_transfer.sql
-- Description:
--   1. Creates normalized public.player_transfer_requests linking public.profiles and public.clubs.
--   2. Multi-party transfer state machine (PENDING_OUTGOING_RELEASE -> PENDING_INCOMING_ACCEPTANCE -> COMPLETED / REJECTED / CANCELLED).
--   3. Database constraint: from_club_id <> to_club_id.
--   4. Partial unique invariant: Exactly ONE pending transfer per player globally.
--   5. Row Level Security: Direct client REST mutations (INSERT/UPDATE/DELETE) are denied.
--   6. Security Definer RPCs with fixed search_path for request, release, acceptance, atomic completion, rejection, cancellation, and direct admin execution.
--   7. Reuses P32/P33 public.get_coach_team_authority(uuid, uuid), public.is_super_admin(uuid), and P35 public.club_memberships.
--   8. Zero modifications to historical tournament snapshots, closure seals, or match records.
-- ==============================================================================

-- 1. Create public.player_transfer_requests Table
CREATE TABLE IF NOT EXISTS public.player_transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    from_club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
    to_club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'PENDING_OUTGOING_RELEASE' CHECK (status IN (
        'PENDING_OUTGOING_RELEASE',
        'PENDING_INCOMING_ACCEPTANCE',
        'COMPLETED',
        'REJECTED',
        'CANCELLED'
    )),
    requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    outgoing_approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    outgoing_reviewed_at TIMESTAMPTZ,
    incoming_approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    incoming_reviewed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    rejected_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    reason TEXT,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Distinct club constraint
    CONSTRAINT chk_distinct_transfer_clubs CHECK (from_club_id <> to_club_id)
);

-- 2. Indexes for Performance and Concurrency Invariants
-- Unique invariant: Exactly one pending transfer request per player globally
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_pending_transfer_per_player
    ON public.player_transfer_requests (player_user_id)
    WHERE status IN ('PENDING_OUTGOING_RELEASE', 'PENDING_INCOMING_ACCEPTANCE');

-- Lookups
CREATE INDEX IF NOT EXISTS idx_transfer_player ON public.player_transfer_requests (player_user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_from_club ON public.player_transfer_requests (from_club_id);
CREATE INDEX IF NOT EXISTS idx_transfer_to_club ON public.player_transfer_requests (to_club_id);
CREATE INDEX IF NOT EXISTS idx_transfer_status ON public.player_transfer_requests (status);
CREATE INDEX IF NOT EXISTS idx_transfer_created_at ON public.player_transfer_requests (created_at DESC);

-- 3. Automatic updated_at Trigger
CREATE OR REPLACE FUNCTION public.handle_player_transfer_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_transfer_updated_at ON public.player_transfer_requests;
CREATE TRIGGER trg_player_transfer_updated_at
    BEFORE UPDATE ON public.player_transfer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_player_transfer_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE public.player_transfer_requests ENABLE ROW LEVEL SECURITY;

-- 4.1 SELECT Policy: Restricted to the player, involved Club A coach, involved Club B coach, or Super Admin
DROP POLICY IF EXISTS "Involved parties and admins can view transfer requests" ON public.player_transfer_requests;
CREATE POLICY "Involved parties and admins can view transfer requests"
    ON public.player_transfer_requests
    FOR SELECT
    TO authenticated
    USING (
        player_user_id = auth.uid() OR
        requested_by = auth.uid() OR
        public.get_coach_team_authority(auth.uid(), from_club_id) OR
        public.get_coach_team_authority(auth.uid(), to_club_id) OR
        public.is_super_admin(auth.uid())
    );

-- 4.2 Restrict Direct Client REST Mutations (All writes routed through SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Direct client inserts denied on player_transfer_requests" ON public.player_transfer_requests;
CREATE POLICY "Direct client inserts denied on player_transfer_requests"
    ON public.player_transfer_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS "Direct client updates denied on player_transfer_requests" ON public.player_transfer_requests;
CREATE POLICY "Direct client updates denied on player_transfer_requests"
    ON public.player_transfer_requests
    FOR UPDATE
    TO authenticated
    USING (false);

DROP POLICY IF EXISTS "Direct client deletes denied on player_transfer_requests" ON public.player_transfer_requests;
CREATE POLICY "Direct client deletes denied on player_transfer_requests"
    ON public.player_transfer_requests
    FOR DELETE
    TO authenticated
    USING (false);


-- ==============================================================================
-- 5. AUTHORITATIVE SECURITY DEFINER RPCs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- RPC 1: request_player_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_player_transfer(
    p_to_club_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_active_membership RECORD;
    v_target_club_exists BOOLEAN;
    v_has_pending_transfer BOOLEAN;
    v_new_transfer_id UUID;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Resolve caller's current ACTIVE membership (LOCK FOR UPDATE to prevent race)
    SELECT * INTO v_active_membership
    FROM public.club_memberships
    WHERE player_user_id = v_caller_id AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_ACTIVE_MEMBERSHIP: Player must hold an active club membership to initiate a transfer' USING ERRCODE = '22000';
    END IF;

    -- Validate target club exists and is active
    SELECT EXISTS (
        SELECT 1 FROM public.clubs WHERE id = p_to_club_id AND is_active = TRUE
    ) INTO v_target_club_exists;

    IF NOT v_target_club_exists THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND: Target club does not exist or is inactive' USING ERRCODE = '40400';
    END IF;

    -- Validate target club is not the same as current active club
    IF v_active_membership.club_id = p_to_club_id THEN
        RAISE EXCEPTION 'INVALID_TARGET_CLUB: Cannot transfer to the same club currently active' USING ERRCODE = '22000';
    END IF;

    -- Check if player already has an existing pending transfer request
    SELECT EXISTS (
        SELECT 1 FROM public.player_transfer_requests
        WHERE player_user_id = v_caller_id
          AND status IN ('PENDING_OUTGOING_RELEASE', 'PENDING_INCOMING_ACCEPTANCE')
    ) INTO v_has_pending_transfer;

    IF v_has_pending_transfer THEN
        RAISE EXCEPTION 'DUPLICATE_PENDING_TRANSFER: Player already has an active pending transfer request' USING ERRCODE = '23505';
    END IF;

    -- Create transfer request in PENDING_OUTGOING_RELEASE status
    INSERT INTO public.player_transfer_requests (
        player_user_id,
        from_club_id,
        to_club_id,
        status,
        requested_by,
        reason,
        created_at,
        updated_at
    ) VALUES (
        v_caller_id,
        v_active_membership.club_id,
        p_to_club_id,
        'PENDING_OUTGOING_RELEASE',
        v_caller_id,
        p_reason,
        v_now,
        v_now
    )
    RETURNING id INTO v_new_transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_new_transfer_id,
        'status', 'PENDING_OUTGOING_RELEASE',
        'from_club_id', v_active_membership.club_id,
        'to_club_id', p_to_club_id,
        'message', 'Transfer request submitted. Awaiting outgoing club release approval.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 2: approve_outgoing_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_outgoing_transfer(
    p_transfer_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_transfer RECORD;
    v_is_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock transfer request FOR UPDATE
    SELECT * INTO v_transfer
    FROM public.player_transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Specified transfer request does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_transfer.status != 'PENDING_OUTGOING_RELEASE' THEN
        RAISE EXCEPTION 'INVALID_STATE: Transfer request is not awaiting outgoing release approval' USING ERRCODE = '22000';
    END IF;

    v_is_coach := public.get_coach_team_authority(v_caller_id, v_transfer.from_club_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    IF NOT (v_is_coach OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for the outgoing club' USING ERRCODE = '40300';
    END IF;

    -- Prevent self-approval (unless Super Admin)
    IF v_transfer.player_user_id = v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN: Player cannot approve their own outgoing transfer' USING ERRCODE = '40300';
    END IF;

    -- Transition state to PENDING_INCOMING_ACCEPTANCE
    UPDATE public.player_transfer_requests
    SET status = 'PENDING_INCOMING_ACCEPTANCE',
        outgoing_approved_by = v_caller_id,
        outgoing_reviewed_at = v_now,
        review_notes = CASE 
            WHEN p_notes IS NOT NULL AND review_notes IS NOT NULL THEN review_notes || ' | Outgoing: ' || p_notes
            WHEN p_notes IS NOT NULL THEN 'Outgoing: ' || p_notes
            ELSE review_notes
        END,
        updated_at = v_now
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', p_transfer_id,
        'status', 'PENDING_INCOMING_ACCEPTANCE',
        'message', 'Outgoing club release approved. Awaiting incoming club acceptance.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 3: approve_incoming_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_incoming_transfer(
    p_transfer_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_transfer RECORD;
    v_active_membership RECORD;
    v_is_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_new_membership_id UUID;
    v_tx_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock transfer request FOR UPDATE
    SELECT * INTO v_transfer
    FROM public.player_transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Specified transfer request does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_transfer.status != 'PENDING_INCOMING_ACCEPTANCE' THEN
        RAISE EXCEPTION 'INVALID_STATE: Transfer request is not awaiting incoming acceptance' USING ERRCODE = '22000';
    END IF;

    v_is_coach := public.get_coach_team_authority(v_caller_id, v_transfer.to_club_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    IF NOT (v_is_coach OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for the incoming club' USING ERRCODE = '40300';
    END IF;

    -- Prevent self-approval (unless Super Admin)
    IF v_transfer.player_user_id = v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN: Player cannot accept their own incoming transfer' USING ERRCODE = '40300';
    END IF;

    -- Lock player's current ACTIVE membership FOR UPDATE
    SELECT * INTO v_active_membership
    FROM public.club_memberships
    WHERE player_user_id = v_transfer.player_user_id AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_ACTIVE_MEMBERSHIP: Player active membership no longer found' USING ERRCODE = '22000';
    END IF;

    IF v_active_membership.club_id != v_transfer.from_club_id THEN
        RAISE EXCEPTION 'MEMBERSHIP_MISMATCH: Current active membership does not match transfer from_club' USING ERRCODE = '22000';
    END IF;

    -- ATOMIC TRANSITION STEP 1: Update Old Membership -> TRANSFERRED
    UPDATE public.club_memberships
    SET status = 'TRANSFERRED',
        effective_to = v_tx_now,
        review_notes = CASE 
            WHEN review_notes IS NOT NULL THEN review_notes || ' | Transferred to Club ' || v_transfer.to_club_id
            ELSE 'Transferred to Club ' || v_transfer.to_club_id
        END,
        updated_at = v_tx_now
    WHERE id = v_active_membership.id;

    -- ATOMIC TRANSITION STEP 2: Insert New Active Membership for Target Club
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
        v_transfer.player_user_id,
        v_transfer.to_club_id,
        'ACTIVE',
        v_active_membership.membership_type,
        v_tx_now,
        NULL,
        v_transfer.requested_by,
        v_caller_id,
        v_tx_now,
        COALESCE(p_notes, 'Transferred via request ' || p_transfer_id::text),
        v_tx_now,
        v_tx_now
    )
    RETURNING id INTO v_new_membership_id;

    -- ATOMIC TRANSITION STEP 3: Mark Transfer Request COMPLETED
    UPDATE public.player_transfer_requests
    SET status = 'COMPLETED',
        incoming_approved_by = v_caller_id,
        incoming_reviewed_at = v_tx_now,
        completed_by = v_caller_id,
        completed_at = v_tx_now,
        review_notes = CASE 
            WHEN p_notes IS NOT NULL AND review_notes IS NOT NULL THEN review_notes || ' | Incoming: ' || p_notes
            WHEN p_notes IS NOT NULL THEN 'Incoming: ' || p_notes
            ELSE review_notes
        END,
        updated_at = v_tx_now
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', p_transfer_id,
        'status', 'COMPLETED',
        'new_membership_id', v_new_membership_id,
        'effective_timestamp', v_tx_now,
        'from_club_id', v_transfer.from_club_id,
        'to_club_id', v_transfer.to_club_id,
        'message', 'Player transfer accepted and completed atomically.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 4: reject_player_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_player_transfer(
    p_transfer_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_transfer RECORD;
    v_is_from_coach BOOLEAN;
    v_is_to_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock transfer request FOR UPDATE
    SELECT * INTO v_transfer
    FROM public.player_transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Specified transfer request does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_transfer.status IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'INVALID_STATE: Cannot reject a finalized transfer request' USING ERRCODE = '22000';
    END IF;

    v_is_from_coach := public.get_coach_team_authority(v_caller_id, v_transfer.from_club_id);
    v_is_to_coach := public.get_coach_team_authority(v_caller_id, v_transfer.to_club_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    IF NOT (v_is_from_coach OR v_is_to_coach OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not authorized to reject this transfer request' USING ERRCODE = '40300';
    END IF;

    -- Update to REJECTED
    UPDATE public.player_transfer_requests
    SET status = 'REJECTED',
        rejected_by = v_caller_id,
        rejected_at = v_now,
        review_notes = CASE 
            WHEN p_reason IS NOT NULL AND review_notes IS NOT NULL THEN review_notes || ' | Rejected: ' || p_reason
            WHEN p_reason IS NOT NULL THEN 'Rejected: ' || p_reason
            ELSE review_notes
        END,
        updated_at = v_now
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', p_transfer_id,
        'status', 'REJECTED',
        'message', 'Player transfer request rejected.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 5: cancel_player_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_player_transfer(
    p_transfer_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_transfer RECORD;
    v_is_requester BOOLEAN;
    v_is_admin BOOLEAN;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    -- Lock transfer request FOR UPDATE
    SELECT * INTO v_transfer
    FROM public.player_transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Specified transfer request does not exist' USING ERRCODE = '40400';
    END IF;

    IF v_transfer.status IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'INVALID_STATE: Cannot cancel a finalized transfer request' USING ERRCODE = '22000';
    END IF;

    v_is_requester := (v_caller_id = v_transfer.requested_by OR v_caller_id = v_transfer.player_user_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    IF NOT (v_is_requester OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not authorized to cancel this transfer request' USING ERRCODE = '40300';
    END IF;

    -- Update to CANCELLED
    UPDATE public.player_transfer_requests
    SET status = 'CANCELLED',
        cancelled_by = v_caller_id,
        cancelled_at = v_now,
        review_notes = CASE 
            WHEN p_reason IS NOT NULL AND review_notes IS NOT NULL THEN review_notes || ' | Cancelled: ' || p_reason
            WHEN p_reason IS NOT NULL THEN 'Cancelled: ' || p_reason
            ELSE review_notes
        END,
        updated_at = v_now
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', p_transfer_id,
        'status', 'CANCELLED',
        'message', 'Player transfer request cancelled.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 6: direct_execute_player_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.direct_execute_player_transfer(
    p_player_user_id UUID,
    p_to_club_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_active_membership RECORD;
    v_target_club_exists BOOLEAN;
    v_new_membership_id UUID;
    v_transfer_id UUID;
    v_tx_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    IF NOT public.is_super_admin(v_caller_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Direct transfer execution is restricted to Super Admins' USING ERRCODE = '40300';
    END IF;

    -- Clean up and lock any existing pending transfers for this player FIRST (canonical lock order)
    UPDATE public.player_transfer_requests
    SET status = 'CANCELLED',
        cancelled_by = v_caller_id,
        cancelled_at = v_tx_now,
        review_notes = 'Cancelled due to direct Super Admin transfer execution',
        updated_at = v_tx_now
    WHERE player_user_id = p_player_user_id
      AND status IN ('PENDING_OUTGOING_RELEASE', 'PENDING_INCOMING_ACCEPTANCE');

    -- Lock player's current ACTIVE membership FOR UPDATE SECOND
    SELECT * INTO v_active_membership
    FROM public.club_memberships
    WHERE player_user_id = p_player_user_id AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_ACTIVE_MEMBERSHIP: Player must hold an active club membership to execute a transfer' USING ERRCODE = '22000';
    END IF;

    -- Validate target club exists and is active
    SELECT EXISTS (
        SELECT 1 FROM public.clubs WHERE id = p_to_club_id AND is_active = TRUE
    ) INTO v_target_club_exists;

    IF NOT v_target_club_exists THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND: Target club does not exist or is inactive' USING ERRCODE = '40400';
    END IF;

    IF v_active_membership.club_id = p_to_club_id THEN
        RAISE EXCEPTION 'INVALID_TARGET_CLUB: Cannot transfer to the same club currently active' USING ERRCODE = '22000';
    END IF;

    -- Create transfer audit row
    INSERT INTO public.player_transfer_requests (
        player_user_id,
        from_club_id,
        to_club_id,
        status,
        requested_by,
        outgoing_approved_by,
        outgoing_reviewed_at,
        incoming_approved_by,
        incoming_reviewed_at,
        completed_by,
        completed_at,
        reason,
        review_notes,
        created_at,
        updated_at
    ) VALUES (
        p_player_user_id,
        v_active_membership.club_id,
        p_to_club_id,
        'COMPLETED',
        v_caller_id,
        v_caller_id,
        v_tx_now,
        v_caller_id,
        v_tx_now,
        v_caller_id,
        v_tx_now,
        'Super Admin direct transfer override',
        p_notes,
        v_tx_now,
        v_tx_now
    )
    RETURNING id INTO v_transfer_id;

    -- ATOMIC TRANSITION STEP 1: Old Membership -> TRANSFERRED
    UPDATE public.club_memberships
    SET status = 'TRANSFERRED',
        effective_to = v_tx_now,
        review_notes = CASE 
            WHEN review_notes IS NOT NULL THEN review_notes || ' | Direct Super Admin transfer to Club ' || p_to_club_id
            ELSE 'Direct Super Admin transfer to Club ' || p_to_club_id
        END,
        updated_at = v_tx_now
    WHERE id = v_active_membership.id;

    -- ATOMIC TRANSITION STEP 2: New Active Membership for Target Club
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
        p_to_club_id,
        'ACTIVE',
        v_active_membership.membership_type,
        v_tx_now,
        NULL,
        v_caller_id,
        v_caller_id,
        v_tx_now,
        COALESCE(p_notes, 'Direct Super Admin transfer override'),
        v_tx_now,
        v_tx_now
    )
    RETURNING id INTO v_new_membership_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'status', 'COMPLETED',
        'new_membership_id', v_new_membership_id,
        'effective_timestamp', v_tx_now,
        'from_club_id', v_active_membership.club_id,
        'to_club_id', p_to_club_id,
        'message', 'Direct player transfer executed atomically by Super Admin.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 7: get_pending_club_transfers
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_club_transfers(
    p_club_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_is_coach BOOLEAN;
    v_is_admin BOOLEAN;
    v_transfers JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated' USING ERRCODE = '40100';
    END IF;

    v_is_coach := public.get_coach_team_authority(v_caller_id, p_club_id);
    v_is_admin := public.is_super_admin(v_caller_id);

    IF NOT (v_is_coach OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not authorized to view club transfers' USING ERRCODE = '40300';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', ptr.id,
            'player_user_id', ptr.player_user_id,
            'player_name', p.full_name,
            'from_club_id', ptr.from_club_id,
            'from_club_name', fc.name,
            'to_club_id', ptr.to_club_id,
            'to_club_name', tc.name,
            'status', ptr.status,
            'requested_by', ptr.requested_by,
            'reason', ptr.reason,
            'review_notes', ptr.review_notes,
            'outgoing_approved_by', ptr.outgoing_approved_by,
            'outgoing_reviewed_at', ptr.outgoing_reviewed_at,
            'incoming_approved_by', ptr.incoming_approved_by,
            'incoming_reviewed_at', ptr.incoming_reviewed_at,
            'created_at', ptr.created_at,
            'transfer_direction', CASE 
                WHEN ptr.from_club_id = p_club_id THEN 'OUTGOING'
                ELSE 'INCOMING'
            END
        ) ORDER BY ptr.created_at DESC
    ) INTO v_transfers
    FROM public.player_transfer_requests ptr
    JOIN public.profiles p ON p.id = ptr.player_user_id
    JOIN public.clubs fc ON fc.id = ptr.from_club_id
    JOIN public.clubs tc ON tc.id = ptr.to_club_id
    WHERE (ptr.from_club_id = p_club_id OR ptr.to_club_id = p_club_id)
      AND ptr.status IN ('PENDING_OUTGOING_RELEASE', 'PENDING_INCOMING_ACCEPTANCE');

    RETURN COALESCE(v_transfers, '[]'::jsonb);
END;
$$;


-- ------------------------------------------------------------------------------
-- RPC 8: get_player_transfer_history
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_player_transfer_history(
    p_player_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

    IF NOT (v_is_self OR v_is_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN: Viewing complete transfer history is restricted to athlete and admins' USING ERRCODE = '40300';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', ptr.id,
            'player_user_id', ptr.player_user_id,
            'from_club_id', ptr.from_club_id,
            'from_club_name', fc.name,
            'to_club_id', ptr.to_club_id,
            'to_club_name', tc.name,
            'status', ptr.status,
            'reason', ptr.reason,
            'review_notes', ptr.review_notes,
            'completed_at', ptr.completed_at,
            'rejected_at', ptr.rejected_at,
            'cancelled_at', ptr.cancelled_at,
            'created_at', ptr.created_at
        ) ORDER BY ptr.created_at DESC
    ) INTO v_history
    FROM public.player_transfer_requests ptr
    JOIN public.clubs fc ON fc.id = ptr.from_club_id
    JOIN public.clubs tc ON tc.id = ptr.to_club_id
    WHERE ptr.player_user_id = p_player_user_id;

    RETURN COALESCE(v_history, '[]'::jsonb);
END;
$$;


-- ==============================================================================
-- 6. EXPLICIT PRIVILEGE REVOCATIONS & GRANTS (LEAST PRIVILEGE)
-- ==============================================================================

-- 6.1 Table Privileges
REVOKE ALL ON TABLE public.player_transfer_requests FROM PUBLIC, anon, service_role;
GRANT SELECT ON TABLE public.player_transfer_requests TO authenticated;

-- 6.2 Trigger Function
REVOKE ALL ON FUNCTION public.handle_player_transfer_updated_at() FROM PUBLIC, anon, service_role;

-- 6.3 Authoritative RPC Privileges
REVOKE ALL ON FUNCTION public.request_player_transfer(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_player_transfer(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_outgoing_transfer(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_outgoing_transfer(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_incoming_transfer(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_incoming_transfer(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_player_transfer(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_player_transfer(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_player_transfer(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_player_transfer(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.direct_execute_player_transfer(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.direct_execute_player_transfer(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_pending_club_transfers(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_club_transfers(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_player_transfer_history(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_player_transfer_history(UUID) TO authenticated;
