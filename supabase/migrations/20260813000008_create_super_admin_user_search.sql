-- Phase 1J-B Migration: Create Super Admin User Search RPC
-- Migration: 20260813000008_create_super_admin_user_search.sql
--
-- PURPOSE:
-- Implements the database-authoritative `public.search_users_for_admin(p_query TEXT)` RPC.
-- Allows active Super Admins to search profiles by email, full name, or exact UUID,
-- returning matching records with aggregated permanent roles.
--
-- SECURITY & AUTHORIZATION INVARIANTS:
-- 1. SECURITY DEFINER with `search_path TO 'public'`.
-- 2. Requester authentication and active `SUPER_ADMIN` status strictly verified via `auth.uid()`.
-- 3. Requester profile must possess `status = 'ACTIVE'`.
-- 4. Search matches by `email ILIKE`, `full_name ILIKE`, or exact `UUID`.
-- 5. Returns aggregated permanent roles from `public.user_roles`.
-- 6. Maximum 25 results returned.
-- 7. Execution revoked from `PUBLIC` and `anon`; granted strictly to `authenticated`.
-- 8. Existing RLS policies on `public.profiles` and `public.user_roles` are 100% UNTOUCHED.

CREATE OR REPLACE FUNCTION public.search_users_for_admin(
  p_query TEXT
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  account_status TEXT,
  avatar_url TEXT,
  roles public.app_role[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_is_super_admin BOOLEAN;
  v_requester_status TEXT;
  v_clean_query TEXT;
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

  -- 3. Normalize Search Query
  v_clean_query := TRIM(COALESCE(p_query, ''));

  -- 4. Execute Query with Aggregated Roles (Max 25 results)
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.full_name,
    p.status AS account_status,
    p.avatar_url,
    COALESCE(
      ARRAY_AGG(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL),
      ARRAY[]::public.app_role[]
    ) AS roles
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE (
    v_clean_query = ''
    OR p.email ILIKE '%' || v_clean_query || '%'
    OR (p.full_name IS NOT NULL AND p.full_name ILIKE '%' || v_clean_query || '%')
    OR (
      CASE 
        WHEN v_clean_query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
        THEN p.id = v_clean_query::UUID 
        ELSE FALSE 
      END
    )
  )
  GROUP BY p.id, p.email, p.full_name, p.status, p.avatar_url
  ORDER BY p.email ASC
  LIMIT 25;
END;
$$;

-- Revoke all permissions from public and anon; grant exclusively to authenticated
REVOKE ALL ON FUNCTION public.search_users_for_admin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_users_for_admin(TEXT) TO authenticated;
