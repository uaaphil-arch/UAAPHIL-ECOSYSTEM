-- Migration: 20260830000057_create_chat_identities_batch_rpc.sql
-- Domain: Authoritative Cross-Account Chat Identity Resolution Batch RPC
-- Sequence: 000057 (Additive, Non-destructive, Preserves Migrations 000001-000056)
-- Target: Supabase / PostgreSQL 15+
-- Invariant: Least-privilege SECURITY DEFINER read-only RPC for chat participant badge & role rendering.
-- Security Boundaries:
--   1. Authenticated callers only (explicit reject for unauthenticated/anon).
--   2. Strict search_path = public, pg_temp.
--   3. Exposes ONLY safe public chat display projection: user_id, full_name, avatar_url, roles, club_id, club_name, club_short_name.
--   4. Excludes private fields (email, phone, address, preferences, password/auth metadata).
--   5. Zero table RLS weakening (user_roles and profiles stay strictly protected).

CREATE OR REPLACE FUNCTION public.get_chat_identities_batch(
  p_user_ids UUID[]
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  roles TEXT[],
  club_id UUID,
  club_name TEXT,
  club_short_name TEXT
) AS $$
DECLARE
  v_requester_id UUID;
BEGIN
  -- 1. Authorization Check: Require authenticated session
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to resolve chat participant identities.';
  END IF;

  -- 2. Guard against empty or null input
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 3. Return safe chat display identity projection for requested user IDs
  RETURN QUERY
  WITH requested_users AS (
    SELECT DISTINCT u_id
    FROM unnest(p_user_ids) AS u_id
    WHERE u_id IS NOT NULL
  ),
  user_profiles AS (
    SELECT 
      ru.u_id,
      p.full_name,
      p.avatar_url
    FROM requested_users ru
    LEFT JOIN public.profiles p ON p.id = ru.u_id
  ),
  roles_agg AS (
    SELECT 
      ur.user_id AS u_id,
      array_agg(ur.role::TEXT ORDER BY ur.role) AS assigned_roles
    FROM public.user_roles ur
    JOIN requested_users ru ON ru.u_id = ur.user_id
    GROUP BY ur.user_id
  ),
  coach_clubs AS (
    SELECT DISTINCT ON (cc.coach_user_id)
      cc.coach_user_id AS u_id,
      c.id AS club_id,
      c.name AS club_name,
      c.short_name AS club_short_name
    FROM public.club_coaches cc
    JOIN public.clubs c ON c.id = cc.club_id
    JOIN requested_users ru ON ru.u_id = cc.coach_user_id
    WHERE cc.status = 'ACTIVE'
      AND (cc.effective_to IS NULL OR cc.effective_to > timezone('utc'::text, now()))
    ORDER BY cc.coach_user_id, cc.effective_from DESC NULLS LAST
  ),
  athlete_clubs AS (
    SELECT DISTINCT ON (cm.player_user_id)
      cm.player_user_id AS u_id,
      c.id AS club_id,
      c.name AS club_name,
      c.short_name AS club_short_name
    FROM public.club_memberships cm
    JOIN public.clubs c ON c.id = cm.club_id
    JOIN requested_users ru ON ru.u_id = cm.player_user_id
    WHERE cm.status = 'ACTIVE'
      AND (cm.effective_to IS NULL OR cm.effective_to > timezone('utc'::text, now()))
    ORDER BY cm.player_user_id, cm.effective_from DESC NULLS LAST
  )
  SELECT 
    ru.u_id AS user_id,
    COALESCE(up.full_name, 'Unknown User')::TEXT AS full_name,
    up.avatar_url::TEXT AS avatar_url,
    ARRAY(
      SELECT DISTINCT r FROM (
        SELECT unnest(COALESCE(ra.assigned_roles, ARRAY[]::TEXT[])) AS r
        UNION ALL
        SELECT 'COACH' WHERE cc.u_id IS NOT NULL
        UNION ALL
        SELECT 'ATHLETE' WHERE ac.u_id IS NOT NULL
      ) sub
    )::TEXT[] AS roles,
    COALESCE(cc.club_id, ac.club_id) AS club_id,
    COALESCE(cc.club_name, ac.club_name)::TEXT AS club_name,
    COALESCE(cc.club_short_name, ac.club_short_name)::TEXT AS club_short_name
  FROM requested_users ru
  LEFT JOIN user_profiles up ON up.u_id = ru.u_id
  LEFT JOIN roles_agg ra ON ra.u_id = ru.u_id
  LEFT JOIN coach_clubs cc ON cc.u_id = ru.u_id
  LEFT JOIN athlete_clubs ac ON ac.u_id = ru.u_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. Explicit privilege model: Revoke from PUBLIC and anonymous, Grant strictly to authenticated
REVOKE EXECUTE ON FUNCTION public.get_chat_identities_batch(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_identities_batch(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_chat_identities_batch(UUID[]) TO authenticated;
