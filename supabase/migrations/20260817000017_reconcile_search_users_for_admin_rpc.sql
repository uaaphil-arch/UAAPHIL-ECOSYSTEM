-- Migration: 20260817000017_reconcile_search_users_for_admin_rpc.sql
-- Description: Reconciles public.search_users_for_admin with authoritative p_query parameter
--              and direct public.user_roles.role enum queries, removing obsolete public.roles join.

-- 1. Drop existing obsolete function signatures
DROP FUNCTION IF EXISTS public.search_users_for_admin(text);

-- 2. Create the authoritative reconciled search_users_for_admin RPC
CREATE OR REPLACE FUNCTION public.search_users_for_admin(
  p_query TEXT DEFAULT ''
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
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_is_super_admin BOOLEAN;
  v_requester_status TEXT;
  v_clean_query TEXT;
BEGIN
  -- 1. Identify Requester Session
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Requester Super Admin Authority & Active Status
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'::public.app_role),
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

  -- 4. Execute Authoritative Profile and Role Query (Max 25 results)
  RETURN QUERY
  SELECT 
    p.id,
    p.email::TEXT,
    p.full_name::TEXT,
    p.status::TEXT AS account_status,
    p.avatar_url::TEXT,
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

-- 3. Grant execute privileges exclusively to authenticated users
REVOKE ALL ON FUNCTION public.search_users_for_admin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_users_for_admin(TEXT) TO authenticated;

