-- Migration: 20260822000042_break_tournament_snapshots_rls_recursion.sql
-- Description: Breaks mutual RLS recursion between tournament_snapshots and event_assignments via a hardened SECURITY DEFINER helper function barrier.

BEGIN;

-- 1. Create narrowly-scoped, hardened SECURITY DEFINER helper function to act as an RLS recursion barrier
CREATE OR REPLACE FUNCTION public.is_assigned_snapshot_official(
  p_snapshot_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_snapshot_id IS NULL OR p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.event_assignments ea
    JOIN public.events e ON e.id = ea.event_id
    WHERE e.snapshot_id = p_snapshot_id
      AND ea.user_id = p_user_id
      AND ea.is_active = true
      AND ea.revoked_at IS NULL
  );
END;
$$;

-- 2. Configure execution permissions strictly for authenticated role
REVOKE ALL ON FUNCTION public.is_assigned_snapshot_official(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_snapshot_official(UUID, UUID) TO authenticated;

-- 3. Drop existing recursive SELECT policy on tournament_snapshots
DROP POLICY IF EXISTS tournament_snapshots_select_policy ON public.tournament_snapshots;

-- 4. Create reconciled, non-recursive SELECT policy for tournament_snapshots
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
      -- Clause D: Caller is an assigned tournament official for an event in this snapshot (via helper barrier)
      OR public.is_assigned_snapshot_official(tournament_snapshots.id, auth.uid())
    )
  )
);

COMMIT;

/*
================================================================================
ROLLBACK INSTRUCTIONS (IF REVERSION IS REQUIRED):
================================================================================
BEGIN;

-- 1. Drop the updated policy
DROP POLICY IF EXISTS tournament_snapshots_select_policy ON public.tournament_snapshots;

-- 2. Re-create previous direct-query policy (or previous snapshot policy)
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

-- 3. Drop helper function
DROP FUNCTION IF EXISTS public.is_assigned_snapshot_official(UUID, UUID);

COMMIT;
================================================================================
*/
