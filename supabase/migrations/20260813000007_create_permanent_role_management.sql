-- Phase 1I Migration: Create Permanent Role Management RPCs
-- Migration: 20260813000007_create_permanent_role_management.sql
--
-- PURPOSE:
-- Implements the database-authoritative permanent role management RPCs (`assign_permanent_role`
-- and `revoke_permanent_role`).
--
-- SECURITY & AUTHORIZATION INVARIANTS:
-- 1. SECURITY DEFINER with `search_path TO 'public'`.
-- 2. Requester authentication and active `SUPER_ADMIN` status strictly verified via `auth.uid()`.
-- 3. `SUPER_ADMIN` role cannot be assigned or revoked via permanent role management (exclusive to bootstrap).
-- 4. Self-mutation by Super Admins is strictly blocked.
-- 5. Target profile must exist and must possess `status = 'ACTIVE'` for both assign and revoke.
-- 6. SQLSTATE error codes are formally enforced on all exception conditions.
-- 7. Additive multi-role preservation and idempotent operations.
-- 8. Execution granted strictly to `authenticated`; revoked from `PUBLIC` and `anon`.

-- -----------------------------------------------------------------------------
-- Function: public.assign_permanent_role
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_permanent_role(
  p_target_user_id UUID,
  p_role public.app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_is_super_admin BOOLEAN;
  v_requester_status TEXT;
  v_target_status TEXT;
  v_inserted BOOLEAN;
BEGIN
  -- 1. Identify Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Requester Super Admin Authority & Active Status
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'),
    p.status
  INTO v_requester_is_super_admin, v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF NOT COALESCE(v_requester_is_super_admin, FALSE) OR v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not possess active SUPER_ADMIN role'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Validate Target Parameter Nullability
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 4. Validate Role Boundary (SUPER_ADMIN cannot be assigned via RPC)
  IF p_role = 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'INVALID_ROLE: SUPER_ADMIN role cannot be assigned via permanent role management'
      USING ERRCODE = '42201';
  END IF;

  IF p_role NOT IN ('ADMIN', 'ORGANIZER', 'COACH') THEN
    RAISE EXCEPTION 'INVALID_ROLE: Role must be one of ADMIN, ORGANIZER, COACH'
      USING ERRCODE = '42200';
  END IF;

  -- 5. Self-Mutation Guard
  IF p_target_user_id = v_requester_id THEN
    RAISE EXCEPTION 'SELF_MUTATION_FORBIDDEN: Super Admins cannot assign roles to their own account'
      USING ERRCODE = '42203';
  END IF;

  -- 6. Validate Target Profile & Enforce ACTIVE Status
  SELECT p.status INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  FOR SHARE;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE: Target profile account status is not ACTIVE'
      USING ERRCODE = '42202';
  END IF;

  -- 7. Insert Role Idempotently
  INSERT INTO public.user_roles (user_id, role, assigned_by, created_at)
  VALUES (p_target_user_id, p_role, v_requester_id, NOW())
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF v_inserted IS TRUE THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'ASSIGNED',
      'user_id', p_target_user_id,
      'role', p_role,
      'assigned_by', v_requester_id
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'action', 'ALREADY_ASSIGNED',
      'user_id', p_target_user_id,
      'role', p_role,
      'assigned_by', v_requester_id
    );
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Function: public.revoke_permanent_role
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_permanent_role(
  p_target_user_id UUID,
  p_role public.app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_is_super_admin BOOLEAN;
  v_requester_status TEXT;
  v_target_status TEXT;
  v_deleted BOOLEAN;
BEGIN
  -- 1. Identify Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Requester Super Admin Authority & Active Status
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'),
    p.status
  INTO v_requester_is_super_admin, v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF NOT COALESCE(v_requester_is_super_admin, FALSE) OR v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester does not possess active SUPER_ADMIN role'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Validate Target Parameter Nullability
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 4. Validate Role Boundary (SUPER_ADMIN cannot be revoked via RPC)
  IF p_role = 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'INVALID_ROLE: SUPER_ADMIN role cannot be revoked via permanent role management'
      USING ERRCODE = '42201';
  END IF;

  IF p_role NOT IN ('ADMIN', 'ORGANIZER', 'COACH') THEN
    RAISE EXCEPTION 'INVALID_ROLE: Role must be one of ADMIN, ORGANIZER, COACH'
      USING ERRCODE = '42200';
  END IF;

  -- 5. Self-Mutation Guard
  IF p_target_user_id = v_requester_id THEN
    RAISE EXCEPTION 'SELF_MUTATION_FORBIDDEN: Super Admins cannot revoke roles from their own account'
      USING ERRCODE = '42203';
  END IF;

  -- 6. Validate Target Profile & Enforce ACTIVE Status (Required Correction)
  SELECT p.status INTO v_target_status
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  FOR SHARE;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE: Target profile account status is not ACTIVE'
      USING ERRCODE = '42202';
  END IF;

  -- 7. Delete Role Idempotently
  DELETE FROM public.user_roles
  WHERE user_id = p_target_user_id AND role = p_role
  RETURNING TRUE INTO v_deleted;

  IF v_deleted IS TRUE THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'REVOKED',
      'user_id', p_target_user_id,
      'role', p_role,
      'revoked_by', v_requester_id
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'action', 'NOT_FOUND',
      'user_id', p_target_user_id,
      'role', p_role,
      'revoked_by', v_requester_id
    );
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Function Permissions / Execution Grants
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.assign_permanent_role(UUID, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_permanent_role(UUID, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_permanent_role(UUID, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.revoke_permanent_role(UUID, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_permanent_role(UUID, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_permanent_role(UUID, public.app_role) TO authenticated;
