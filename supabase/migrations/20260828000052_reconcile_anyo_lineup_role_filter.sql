-- ============================================================================
-- Migration: 20260828000052_reconcile_anyo_lineup_role_filter.sql
-- Subsystem: Anyo Competition Engine & Lineup Eligibility Reconciliation
-- Description: Reconciles public.initialize_anyo_category_session to strictly
--              filter eligible participants by lineup_role = 'LINEUP' in addition
--              to is_approved = TRUE.
--
-- Invariant:
--   - APPROVED + LINEUP = INCLUDED
--   - APPROVED + legacy NULL lineup_role = INCLUDED
--   - APPROVED + RESERVE = EXCLUDED
--   - APPROVED + WITHDRAWN = EXCLUDED
--   - UNAPPROVED = EXCLUDED regardless of lineup_role
--
-- Security:
--   - Language: plpgsql
--   - Security: SECURITY DEFINER
--   - Search Path: public, pg_temp
--   - Grants: EXECUTE to authenticated, service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.initialize_anyo_category_session(
  p_tournament_id UUID,
  p_event_id UUID,
  p_court_id UUID DEFAULT NULL,
  p_panel_size public.anyo_panel_size DEFAULT '5_JUDGES',
  p_calc_method public.anyo_calc_method DEFAULT 'OLYMPIC_TRIM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_event RECORD;
  v_session RECORD;
  v_reg RECORD;
  v_order_counter INT := 1;
  v_session_id UUID;
BEGIN
  -- 1. Auth check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '40100';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_authorized_tournament_official(v_requester_id, p_tournament_id, p_event_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester is not authorized for this tournament' USING ERRCODE = '40300';
  END IF;

  -- 3. Fetch and validate event with snapshot tournament resolution
  SELECT e.*, ts.tournament_id AS snapshot_tournament_id
  INTO v_event
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE e.id = p_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.snapshot_tournament_id <> p_tournament_id THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Event does not belong to tournament' USING ERRCODE = '42501';
  END IF;

  -- 4. Check or create session
  SELECT * INTO v_session FROM public.anyo_category_sessions
  WHERE tournament_id = p_tournament_id AND event_id = p_event_id;

  IF v_session.id IS NOT NULL THEN
    v_session_id := v_session.id;
  ELSE
    INSERT INTO public.anyo_category_sessions (
      tournament_id,
      event_id,
      court_id,
      panel_size,
      calc_method,
      status
    ) VALUES (
      p_tournament_id,
      p_event_id,
      p_court_id,
      p_panel_size,
      p_calc_method,
      'SCHEDULED'::public.anyo_session_status
    )
    RETURNING id INTO v_session_id;

    -- Fetch all approved registrations for this event with active LINEUP role
    FOR v_reg IN (
      SELECT r.id
      FROM public.registrations r
      WHERE r.event_id = p_event_id
      AND r.is_approved = TRUE
      AND COALESCE(r.lineup_role, 'LINEUP') = 'LINEUP'
      ORDER BY r.created_at ASC
    ) LOOP
      INSERT INTO public.anyo_performances (
        session_id,
        tournament_id,
        event_id,
        registration_id,
        order_number,
        status
      ) VALUES (
        v_session_id,
        p_tournament_id,
        p_event_id,
        v_reg.id,
        v_order_counter,
        'WAITING'::public.anyo_performance_status
      );
      v_order_counter := v_order_counter + 1;
    END LOOP;
  END IF;

  -- 5. Audit Log
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    tournament_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    'OFFICIAL',
    'INITIALIZE_ANYO_SESSION',
    'ANYO_SESSION',
    v_session_id,
    p_tournament_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'court_id', p_court_id,
      'panel_size', p_panel_size,
      'calc_method', p_calc_method,
      'total_competitors', v_order_counter - 1
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', v_session_id,
    'tournament_id', p_tournament_id,
    'event_id', p_event_id,
    'total_performers', v_order_counter - 1
  );
END;
$$;

-- Explicitly ensure function permissions are granted to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.initialize_anyo_category_session(
  UUID,
  UUID,
  UUID,
  public.anyo_panel_size,
  public.anyo_calc_method
) TO authenticated, service_role;
