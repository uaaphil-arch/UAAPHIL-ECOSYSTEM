-- ==============================================================================
-- PATCH-001-P36: HARDEN PLAYER MEMBERSHIP PRIVACY AUTHORIZATION
-- ==============================================================================
-- Sequence: 20260818000026_harden_player_membership_privacy.sql
-- Description:
--   1. Hardens public.get_player_active_membership(p_player_user_id UUID) to enforce
--      strict caller authorization:
--      - Unauthenticated caller -> SQLSTATE 40100 (UNAUTHORIZED).
--      - Non-owner & Non-Super-Admin caller -> SQLSTATE 40300 (FORBIDDEN).
--      - Self (owner) or Super Admin -> Returns active club membership JSONB.
--   2. Preserves SECURITY DEFINER, search_path = public, pg_temp, and return contract.
--   3. Explicitly revokes EXECUTE from PUBLIC, anon, and service_role.
--   4. Grants EXECUTE strictly to authenticated.
--   5. Zero data modifications, zero table/index/RLS alterations.
-- ==============================================================================

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

    -- Authorization check: Self (owner) or Super Admin only
    IF NOT (v_caller_id = p_player_user_id OR public.is_super_admin(v_caller_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN: Caller is not authorized to retrieve this athlete active membership' USING ERRCODE = '40300';
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

-- Explicit Privilege Hardening
REVOKE EXECUTE ON FUNCTION public.get_player_active_membership(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_player_active_membership(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_player_active_membership(UUID) FROM service_role;

GRANT EXECUTE ON FUNCTION public.get_player_active_membership(UUID) TO authenticated;
