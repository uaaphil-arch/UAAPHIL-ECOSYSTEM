-- Migration: 20260820000038_reconcile_role_helpers_and_events_rls.sql
-- Description: 
-- 1. Create canonical public.is_super_admin(uuid) helper function.
-- 2. Reconcile public.is_admin_or_higher(uuid) to check canonical app_role values ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER'), removing legacy 'TOURNAMENT_MANAGER'.
-- 3. Reconcile public.events RLS policies for INSERT, UPDATE, and DELETE with strict 'DRAFT' tournament status and snapshot ownership enforcement.

-- 1. Create canonical is_super_admin helper function
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = p_user_id AND role = 'SUPER_ADMIN'::public.app_role
  );
$$;

-- 2. Reconcile is_admin_or_higher helper function
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
    WHERE user_id = p_user_id AND role IN (
      'SUPER_ADMIN'::public.app_role, 
      'ADMIN'::public.app_role, 
      'ORGANIZER'::public.app_role
    )
  );
$$;

-- 3. Reconcile public.events RLS Policies (Strict DRAFT Lifecycle Only)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super Admins can manage all events" ON public.events;
CREATE POLICY "Super Admins can manage all events"
  ON public.events
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Organizers and Admins can insert events" ON public.events;
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
              WHERE user_id = auth.uid() AND role = 'ADMIN'::public.app_role
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );

DROP POLICY IF EXISTS "Organizers and Admins can update events" ON public.events;
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
              WHERE user_id = auth.uid() AND role = 'ADMIN'::public.app_role
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
              WHERE user_id = auth.uid() AND role = 'ADMIN'::public.app_role
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );

DROP POLICY IF EXISTS "Organizers and Admins can delete events" ON public.events;
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
              WHERE user_id = auth.uid() AND role = 'ADMIN'::public.app_role
            )
            OR t.organizer_id = auth.uid()
          )
      )
    )
  );
