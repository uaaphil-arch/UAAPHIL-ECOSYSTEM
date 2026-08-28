-- Migration: 20260819000033_harden_is_admin_or_higher_search_path.sql
-- Description: Harden public.is_admin_or_higher(uuid) with explicit SET search_path = public, pg_temp

CREATE OR REPLACE FUNCTION public.is_admin_or_higher(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = p_user_id AND role IN ('SUPER_ADMIN', 'ADMIN', 'TOURNAMENT_MANAGER')
  );
$$;
