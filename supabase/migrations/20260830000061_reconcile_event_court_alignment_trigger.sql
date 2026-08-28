-- Migration: 20260830000061_reconcile_event_court_alignment_trigger.sql
-- Patch ID: P23-12-RECONCILE-EVENT-COURT-ALIGNMENT-TRIGGER
-- Description: Reconcile public.check_event_court_tournament_alignment to permit event-wide assignments (COURT_MANAGER) with NULL court_id while preserving cross-tournament validation for court-scoped assignments.

CREATE OR REPLACE FUNCTION public.check_event_court_tournament_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_tournament_id UUID;
  v_court_tournament_id UUID;
BEGIN
  -- Event-wide assignments such as COURT_MANAGER
  -- intentionally have no court scope.
  IF NEW.court_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve tournament through the event snapshot.
  SELECT ts.tournament_id
  INTO v_event_tournament_id
  FROM public.events e
  JOIN public.tournament_snapshots ts
    ON ts.id = e.snapshot_id
  WHERE e.id = NEW.event_id;

  IF v_event_tournament_id IS NULL THEN
    RAISE EXCEPTION
      'TOURNAMENT_NOT_FOUND: Unable to resolve tournament for event %',
      NEW.event_id;
  END IF;

  -- Resolve tournament from the assigned court.
  SELECT c.tournament_id
  INTO v_court_tournament_id
  FROM public.courts c
  WHERE c.id = NEW.court_id;

  IF v_court_tournament_id IS NULL THEN
    RAISE EXCEPTION
      'COURT_NOT_FOUND: Court % does not exist or has no tournament.',
      NEW.court_id;
  END IF;

  -- Preserve cross-tournament protection.
  IF v_event_tournament_id <> v_court_tournament_id THEN
    RAISE EXCEPTION
      'TOURNAMENT_MISMATCH: Court % does not belong to the tournament of event %.',
      NEW.court_id,
      NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$;
