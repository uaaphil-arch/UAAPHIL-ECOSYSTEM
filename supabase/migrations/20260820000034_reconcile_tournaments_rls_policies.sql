-- Migration: 20260820000034_reconcile_tournaments_rls_policies.sql
-- Description: Reconcile public.tournaments RLS policies for canonical roles (SUPER_ADMIN, ADMIN, ORGANIZER) with ownership enforcement, eliminating legacy TOURNAMENT_MANAGER references.

-- 1. Ensure RLS is active on public.tournaments
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

-- 2. Drop all legacy and duplicate policies on public.tournaments
DROP POLICY IF EXISTS "Public can view tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments viewable by authenticated users" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_read_public" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_select_policy" ON public.tournaments;

DROP POLICY IF EXISTS "Super Admins can manage all tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_manage_super_admin" ON public.tournaments;
DROP POLICY IF EXISTS "Tournament Managers can insert tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Tournament Managers can update own tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Tournament Managers can view tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Tournament Managers can manage tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Admins can manage tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organizers can create tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organizers and Admins can create tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organizers and Admins can update own tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_insert_policy" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_update_policy" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_delete_policy" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_insert_organizer" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_update_organizer" ON public.tournaments;

-- 3. Public Read Access
CREATE POLICY "Public can view tournaments"
  ON public.tournaments
  FOR SELECT
  TO public
  USING (true);

-- 4. Super Admin Full Access (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Super Admins can manage all tournaments"
  ON public.tournaments
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. Canonical INSERT Policy for Admins and Organizers
-- Allows:
-- - SUPER_ADMIN (via Policy 4 and fallback)
-- - ADMIN (can create tournaments for any organizer or self)
-- - ORGANIZER (can create tournaments ONLY when organizer_id = auth.uid())
-- Denies:
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL, Unauthenticated
CREATE POLICY "Organizers and Admins can create tournaments"
  ON public.tournaments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'ADMIN'
      )
      OR organizer_id = auth.uid()
    )
  );

-- 6. Canonical UPDATE Policy for Admins and Organizers
-- Allows:
-- - SUPER_ADMIN (all tournaments)
-- - ADMIN and ORGANIZER (only tournaments they own through organizer_id)
-- Denies:
-- - Updating tournaments owned by other organizers (unless SUPER_ADMIN)
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL
CREATE POLICY "Organizers and Admins can update own tournaments"
  ON public.tournaments
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      public.is_admin_or_higher(auth.uid())
      AND auth.uid() = organizer_id
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (
      public.is_admin_or_higher(auth.uid())
      AND auth.uid() = organizer_id
    )
  );
