-- Migration: 20260820000035_reconcile_courts_rls_policies.sql
-- Description: Reconcile public.courts RLS policies for canonical roles (SUPER_ADMIN, ADMIN, ORGANIZER) with strict tournament ownership enforcement.

-- 1. Ensure Row Level Security is active on public.courts
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;

-- 2. Drop stale and conflicting write policies on public.courts
DROP POLICY IF EXISTS "Courts viewable by authenticated users" ON public.courts;
DROP POLICY IF EXISTS "Public can view courts" ON public.courts;
DROP POLICY IF EXISTS "courts_read_public" ON public.courts;
DROP POLICY IF EXISTS "courts_select_policy" ON public.courts;

DROP POLICY IF EXISTS "Super Admins can manage all courts" ON public.courts;
DROP POLICY IF EXISTS "courts_manage_super_admin" ON public.courts;
DROP POLICY IF EXISTS "Organizers and Admins can insert courts" ON public.courts;
DROP POLICY IF EXISTS "Organizers and Admins can update courts" ON public.courts;
DROP POLICY IF EXISTS "Organizers and Admins can delete courts" ON public.courts;
DROP POLICY IF EXISTS "Organizers and Admins can manage courts" ON public.courts;
DROP POLICY IF EXISTS "Organizers and Admins can update and delete own courts" ON public.courts;
DROP POLICY IF EXISTS "Tournament Managers can manage courts" ON public.courts;
DROP POLICY IF EXISTS "courts_insert_policy" ON public.courts;
DROP POLICY IF EXISTS "courts_update_policy" ON public.courts;
DROP POLICY IF EXISTS "courts_delete_policy" ON public.courts;

-- 3. Public Read Policy
-- Preserves public and authenticated visibility into competition courts
CREATE POLICY "Public can view courts"
  ON public.courts
  FOR SELECT
  TO public
  USING (true);

-- 4. Super Admin Full Access Policy
-- Grants full management (SELECT, INSERT, UPDATE, DELETE) across all courts
CREATE POLICY "Super Admins can manage all courts"
  ON public.courts
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. Canonical INSERT Policy for Admins and Tournament Organizers
-- Allows:
-- - SUPER_ADMIN (all tournaments)
-- - ADMIN (all tournaments)
-- - ORGANIZER (only tournaments where public.tournaments.organizer_id = auth.uid())
-- Denies:
-- - ORGANIZER on non-owned tournaments (organizer_id != auth.uid())
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL, and UNAUTHENTICATED
CREATE POLICY "Organizers and Admins can insert courts"
  ON public.courts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'ADMIN'
      )
      OR EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  );

-- 6. Canonical UPDATE Policy for Admins and Tournament Organizers
-- Allows:
-- - SUPER_ADMIN (all tournaments)
-- - ADMIN (all tournaments)
-- - ORGANIZER (only tournaments where public.tournaments.organizer_id = auth.uid())
-- Denies:
-- - ORGANIZER on non-owned tournaments (organizer_id != auth.uid())
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL, and UNAUTHENTICATED
CREATE POLICY "Organizers and Admins can update courts"
  ON public.courts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'ADMIN'
    )
    OR (
      public.is_admin_or_higher(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'ADMIN'
    )
    OR (
      public.is_admin_or_higher(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  );

-- 7. Canonical DELETE Policy for Admins and Tournament Organizers
-- Allows:
-- - SUPER_ADMIN (all tournaments)
-- - ADMIN (all tournaments)
-- - ORGANIZER (only tournaments where public.tournaments.organizer_id = auth.uid())
-- Denies:
-- - ORGANIZER on non-owned tournaments (organizer_id != auth.uid())
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL, and UNAUTHENTICATED
CREATE POLICY "Organizers and Admins can delete courts"
  ON public.courts
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'ADMIN'
    )
    OR (
      public.is_admin_or_higher(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  );
