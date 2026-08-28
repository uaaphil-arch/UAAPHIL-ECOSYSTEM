-- ============================================================================
-- RECONCILIATION MIGRATION: 20260821000039_reconcile_lineup_approval_boundary.sql
-- Description: Reconcile Coach Lineup Submission and Organizer Approval Boundary.
-- Invariants:
--   1. coach_set_event_lineup():
--      - New registrations default to is_approved = FALSE, approved_by = NULL.
--      - Existing registrations preserve their current is_approved and approved_by status.
--      - Coach cannot transition is_approved from FALSE to TRUE.
--   2. public.registrations RLS:
--      - Organizers can approve/update registrations for tournaments they organize.
--      - Admins can approve/update registrations for authorized tournaments.
--      - Super Admins retain global registration management.
--      - Coach and Athlete cannot self-approve (enforced via WITH CHECK and policy predicates).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RECONCILE coach_set_event_lineup RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_set_event_lineup(
  p_event_id UUID,
  p_club_id UUID,
  p_lineup_user_ids UUID[],
  p_reserve_user_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_coach BOOLEAN := FALSE;
  v_is_super_admin BOOLEAN := FALSE;
  v_tournament RECORD;
  v_club RECORD;
  v_uid UUID;
  v_ineligible_uid UUID;
  v_lineup_count INT := 0;
  v_reserve_count INT := 0;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Verify Club exists and is active
  SELECT * INTO v_club
  FROM public.clubs
  WHERE id = p_club_id AND is_active = TRUE;

  IF v_club.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club % not found or inactive.', p_club_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify Coach Authority
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'SUPER_ADMIN'::public.app_role
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    v_is_coach := public.get_coach_team_authority(v_caller_id, p_club_id);
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized coach for club %.', p_club_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Lock and Validate Tournament Lifecycle State
  SELECT t.* INTO v_tournament
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id
  FOR UPDATE OF t;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Event or associated tournament not found for event %.', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Lineups cannot be modified when tournament status is %. Tournament is locked.', v_tournament.status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Disjoint Check (Athlete cannot be both LINEUP and RESERVE in same event)
  IF p_lineup_user_ids IS NOT NULL AND p_reserve_user_ids IS NOT NULL THEN
    SELECT unnest(p_lineup_user_ids) INTERSECT SELECT unnest(p_reserve_user_ids) LIMIT 1 INTO v_uid;
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Athlete % cannot be designated as both LINEUP and RESERVE.', v_uid
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Validate Eligibility for LINEUP athletes (Active member of club, active profile, PLAYER role)
  IF p_lineup_user_ids IS NOT NULL AND array_length(p_lineup_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: User % is not an active PLAYER member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- 7. Validate Eligibility for RESERVE athletes
  IF p_reserve_user_ids IS NOT NULL AND array_length(p_reserve_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      SELECT p.id INTO v_ineligible_uid
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'PLAYER'::public.app_role
      JOIN public.club_memberships cm ON cm.player_user_id = p.id AND cm.club_id = p_club_id AND cm.status = 'ACTIVE'
      WHERE p.id = v_uid AND COALESCE(p.account_status, p.status, 'ACTIVE') = 'ACTIVE';

      IF v_ineligible_uid IS NULL THEN
        RAISE EXCEPTION 'INELIGIBLE_ATHLETE: Reserve user % is not an active PLAYER member of club %.', v_uid, p_club_id
          USING ERRCODE = '42200';
      END IF;
    END LOOP;
  END IF;

  -- 8. Apply Lineup & Reserve Assignments Atomically
  -- Mark removed club athletes for this event as WITHDRAWN
  UPDATE public.registrations
  SET lineup_role = 'WITHDRAWN',
      updated_at = timezone('utc'::text, now())
  WHERE event_id = p_event_id
    AND club_id = p_club_id
    AND user_id != ALL(COALESCE(p_lineup_user_ids, ARRAY[]::UUID[]) || COALESCE(p_reserve_user_ids, ARRAY[]::UUID[]))
    AND lineup_role != 'WITHDRAWN';

  -- Upsert LINEUP athletes
  IF p_lineup_user_ids IS NOT NULL AND array_length(p_lineup_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_lineup_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        approved_by,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'LINEUP',
        FALSE, -- Invariant: New Coach submissions default to unapproved (pending review)
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'LINEUP',
          -- Invariant: Preserve existing is_approved and approved_by; never force TRUE
          is_approved = public.registrations.is_approved,
          approved_by = public.registrations.approved_by,
          updated_at = timezone('utc'::text, now());
      
      v_lineup_count := v_lineup_count + 1;
    END LOOP;
  END IF;

  -- Upsert RESERVE athletes
  IF p_reserve_user_ids IS NOT NULL AND array_length(p_reserve_user_ids, 1) > 0 THEN
    FOREACH v_uid IN ARRAY p_reserve_user_ids LOOP
      INSERT INTO public.registrations (
        event_id,
        user_id,
        club_id,
        team_name,
        lineup_role,
        is_approved,
        approved_by,
        created_at,
        updated_at
      ) VALUES (
        p_event_id,
        v_uid,
        p_club_id,
        v_club.name,
        'RESERVE',
        FALSE, -- Invariant: New Coach submissions default to unapproved (pending review)
        NULL,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
      )
      ON CONFLICT (event_id, user_id) DO UPDATE
      SET club_id = p_club_id,
          team_name = v_club.name,
          lineup_role = 'RESERVE',
          -- Invariant: Preserve existing is_approved and approved_by; never force TRUE
          is_approved = public.registrations.is_approved,
          approved_by = public.registrations.approved_by,
          updated_at = timezone('utc'::text, now());

      v_reserve_count := v_reserve_count + 1;
    END LOOP;
  END IF;

  -- 9. Audit Log
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
    v_caller_id,
    CASE WHEN v_is_super_admin THEN 'SUPER_ADMIN' ELSE 'COACH' END,
    'COACH_SET_EVENT_LINEUP',
    'EVENT',
    p_event_id,
    v_tournament.id,
    jsonb_build_object(
      'club_id', p_club_id,
      'club_name', v_club.name,
      'event_id', p_event_id,
      'lineup_count', v_lineup_count,
      'reserve_count', v_reserve_count,
      'lineup_user_ids', p_lineup_user_ids,
      'reserve_user_ids', p_reserve_user_ids
    ),
    timezone('utc'::text, now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'club_id', p_club_id,
    'lineup_count', v_lineup_count,
    'reserve_count', v_reserve_count,
    'tournament_status', v_tournament.status
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. RECONCILE public.registrations RLS POLICIES
-- ----------------------------------------------------------------------------

-- Drop legacy conflicting policy if present
DROP POLICY IF EXISTS "Organizers and Admins can update tournament registrations" ON public.registrations;

-- Create tournament-scoped approval update policy for Organizers and Admins
CREATE POLICY "Organizers and Admins can update tournament registrations"
  ON public.registrations
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_or_higher(auth.uid()) AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.events e
        JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE e.id = registrations.event_id
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
        FROM public.events e
        JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
        JOIN public.tournaments t ON t.id = ts.tournament_id
        WHERE e.id = registrations.event_id
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
