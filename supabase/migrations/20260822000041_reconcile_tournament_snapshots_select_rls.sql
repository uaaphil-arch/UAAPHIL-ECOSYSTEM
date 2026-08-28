-- Migration: 20260822000041_reconcile_tournament_snapshots_select_rls.sql
-- Description: Reconciles tournament_snapshots SELECT RLS to allow active coaches and assigned officials to read active snapshots for published tournaments while preserving strict DRAFT confidentiality, tournament organizer ownership, and SUPER_ADMIN invariants.

BEGIN;

-- 1. Drop existing restrictive SELECT policy
DROP POLICY IF EXISTS tournament_snapshots_select_policy ON public.tournament_snapshots;

-- 2. Create reconciled, hardened SELECT policy with verified schema identifiers and enums
CREATE POLICY tournament_snapshots_select_policy ON public.tournament_snapshots
FOR SELECT
TO authenticated
USING (
  -- Clause A: Tournament Organizer has complete visibility over all snapshots of their tournaments
  EXISTS (
    SELECT 1
    FROM public.tournaments t
    WHERE t.id = tournament_snapshots.tournament_id
      AND t.organizer_id = auth.uid()
  )
  OR
  -- Clause B: Platform Super Administrators have global snapshot visibility
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'SUPER_ADMIN'::app_role
  )
  OR
  -- Clause C & D: Active Coaches and Assigned Officials have visibility on active snapshots for non-DRAFT tournaments
  (
    tournament_snapshots.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_snapshots.tournament_id
        AND t.status IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED', 'ARCHIVED')
    )
    AND (
      -- Clause C: Caller is an active verified coach of a recognized club
      EXISTS (
        SELECT 1
        FROM public.club_coaches cc
        WHERE cc.coach_user_id = auth.uid()
          AND cc.status = 'ACTIVE'
      )
      -- Clause D: Caller is an assigned tournament official for an event in this snapshot
      OR EXISTS (
        SELECT 1
        FROM public.event_assignments ea
        JOIN public.events e ON e.id = ea.event_id
        WHERE e.snapshot_id = tournament_snapshots.id
          AND ea.official_user_id = auth.uid()
          AND ea.assignment_status IN ('PENDING', 'CONFIRMED', 'ACTIVE')
      )
    )
  )
);

COMMIT;

/*
================================================================================
ROLLBACK INSTRUCTIONS (IF REVERSION IS REQUIRED):
================================================================================
BEGIN;

DROP POLICY IF EXISTS tournament_snapshots_select_policy ON public.tournament_snapshots;

CREATE POLICY tournament_snapshots_select_policy ON public.tournament_snapshots
FOR SELECT
TO authenticated
USING (
  (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_snapshots.tournament_id
        AND t.organizer_id = auth.uid()
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'SUPER_ADMIN'::app_role
    )
  )
);

COMMIT;
================================================================================
*/
