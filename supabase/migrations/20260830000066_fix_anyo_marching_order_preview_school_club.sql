-- ============================================================================
-- MIGRATION: 20260830000066_fix_anyo_marching_order_preview_school_club.sql
-- DESCRIPTION: P-ANYO-02-C9 — Correct school_club mapping in get_anyo_marching_order_preview
--
-- ROOT CAUSE:
-- public.profiles does not contain a 'school_club' column.
-- Canonical delegation/school/club for tournament registrations is stored in
-- public.registrations.team_name.
--
-- THIS MIGRATION:
-- 1. Re-declares public.get_anyo_marching_order_preview(UUID) with canonical
--    COALESCE(r.team_name, 'Independent') for 'school_club' in performance JSON.
-- 2. Maintains strict authentication, RBAC official check, and non-anon grants.
-- 3. Does NOT modify profiles schema, registrations schema, or scoring formulas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_anyo_marching_order_preview(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_session RECORD;
  v_performances JSONB;
BEGIN
  -- 1. Authentication Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to preview marching order'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Session Lookup
  SELECT * INTO v_session
  FROM public.anyo_category_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Anyo session with ID % does not exist', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authorization Check
  IF NOT public.is_authorized_tournament_official(v_requester_id, v_session.tournament_id, v_session.event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized to preview marching order for this session'
      USING ERRCODE = '40300';
  END IF;

  -- 4. Aggregate Performance Order and Metadata
  -- Canonical delegation/team is obtained from registrations.team_name (r.team_name)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ap.id,
      'order_number', ap.order_number,
      'status', ap.status,
      'seed_tier', ap.seed_tier,
      'historical_classification', ap.historical_classification,
      'draw_group', ap.draw_group,
      'seed_details', ap.seed_details,
      'seeding_cutoff_at', ap.seeding_cutoff_at,
      'final_score', ap.final_score,
      'final_rank', ap.final_rank,
      'medal_awarded', ap.medal_awarded,
      'athlete_name', p.full_name,
      'athlete_avatar_url', p.avatar_url,
      'team_name', r.team_name,
      'school_club', COALESCE(r.team_name, 'Independent')
    ) ORDER BY ap.order_number ASC
  ) INTO v_performances
  FROM public.anyo_performances ap
  JOIN public.registrations r ON r.id = ap.registration_id
  JOIN public.profiles p ON p.id = r.user_id
  WHERE ap.session_id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'draw_status', v_session.draw_status,
    'draw_version', v_session.draw_version,
    'draw_generated_at', v_session.draw_generated_at,
    'draw_confirmed_at', v_session.draw_confirmed_at,
    'draw_metadata', v_session.draw_metadata,
    'performances', COALESCE(v_performances, '[]'::jsonb)
  );
END;
$$;

-- Explicitly Revoke anonymous access from preview function
REVOKE EXECUTE ON FUNCTION public.get_anyo_marching_order_preview(UUID) FROM anon;

-- Grant execute exclusively to authenticated officials and service role
GRANT EXECUTE ON FUNCTION public.get_anyo_marching_order_preview(UUID) TO authenticated, service_role;
