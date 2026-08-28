-- Migration: 20260820000037_reconcile_events_rls_policies.sql
-- Description: Reconcile public.events RLS policies for canonical roles (SUPER_ADMIN, ADMIN, TOURNAMENT_MANAGER, ORGANIZER) with strict tournament snapshot ownership and DRAFT status enforcement.

-- 1. Ensure Row Level Security is active on public.events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- 2. Drop stale and legacy policies on public.events
DROP POLICY IF EXISTS "Public can view events" ON public.events;
DROP POLICY IF EXISTS "Organizers can manage events" ON public.events;
DROP POLICY IF EXISTS "events_read_public" ON public.events;
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
DROP POLICY IF EXISTS "Super Admins can manage all events" ON public.events;
DROP POLICY IF EXISTS "events_manage_super_admin" ON public.events;
DROP POLICY IF EXISTS "Organizers and Admins can insert events" ON public.events;
DROP POLICY IF EXISTS "Organizers and Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Organizers and Admins can delete events" ON public.events;
DROP POLICY IF EXISTS "Organizers and Admins can manage events" ON public.events;
DROP POLICY IF EXISTS "Tournament Managers can manage events" ON public.events;
DROP POLICY IF EXISTS "events_insert_policy" ON public.events;
DROP POLICY IF EXISTS "events_update_policy" ON public.events;
DROP POLICY IF EXISTS "events_delete_policy" ON public.events;

-- 3. Public Read Policy
-- Preserves public and authenticated visibility into competition events
CREATE POLICY "Public can view events"
  ON public.events
  FOR SELECT
  TO public
  USING (true);

-- 4. Super Admin Full Management Policy
-- Grants full management (SELECT, INSERT, UPDATE, DELETE) across all events
CREATE POLICY "Super Admins can manage all events"
  ON public.events
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. Canonical INSERT Policy for Admins and Tournament Organizers
-- Allows:
-- - SUPER_ADMIN (via Policy 4 and fallback)
-- - ADMIN (can configure events for any tournament in DRAFT)
-- - TOURNAMENT_MANAGER / ORGANIZER (can configure events ONLY when target tournament is in DRAFT AND tournament.organizer_id = auth.uid())
-- Denies:
-- - Mutating events when tournament is NOT in DRAFT (e.g. REGISTRATION_OPEN, ACTIVE, COMPLETED, ARCHIVED)
-- - Mutating events for other organizers' tournaments
-- - COACH, PLAYER, COURT_MANAGER, TABLE_OFFICIAL, Unauthenticated
CREATE POLICY "Organizers and Admins can insert events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.tournament_snapshots ts
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE ts.id = snapshot_id
          AND t.status = 'DRAFT'
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles 
              WHERE user_id = auth.uid() AND role = 'ADMIN'
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );

-- 6. Canonical UPDATE Policy for Admins and Tournament Organizers
CREATE POLICY "Organizers and Admins can update events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.tournament_snapshots ts
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE ts.id = snapshot_id
          AND t.status = 'DRAFT'
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles 
              WHERE user_id = auth.uid() AND role = 'ADMIN'
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.tournament_snapshots ts
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE ts.id = snapshot_id
          AND t.status = 'DRAFT'
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles 
              WHERE user_id = auth.uid() AND role = 'ADMIN'
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );

-- 7. Canonical DELETE Policy for Admins and Tournament Organizers
CREATE POLICY "Organizers and Admins can delete events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.tournament_snapshots ts
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE ts.id = snapshot_id
          AND t.status = 'DRAFT'
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles 
              WHERE user_id = auth.uid() AND role = 'ADMIN'
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );
