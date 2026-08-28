-- Phase 1E: Temporary Event Role & Event Assignment Migration
-- Creates event_role ENUM, public.event_assignments table, tournament alignment trigger, and assignment management RPCs.

-- 1. Create event_role ENUM
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_role') THEN
    CREATE TYPE event_role AS ENUM (
      'COURT_MANAGER',
      'TABLE_OFFICIAL'
    );
  END IF;
END $$;

-- 2. Create public.event_assignments table
CREATE TABLE IF NOT EXISTS public.event_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role event_role NOT NULL,
  court_id UUID NULL REFERENCES public.courts(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT no_self_assignment CHECK (user_id <> assigned_by),
  CONSTRAINT court_manager_court_id_null CHECK (role <> 'COURT_MANAGER' OR court_id IS NULL),
  CONSTRAINT table_official_court_id_not_null CHECK (role <> 'TABLE_OFFICIAL' OR court_id IS NOT NULL)
);

-- Indexes for public.event_assignments
CREATE INDEX IF NOT EXISTS event_assignments_event_id_idx ON public.event_assignments(event_id);
CREATE INDEX IF NOT EXISTS event_assignments_court_id_idx ON public.event_assignments(court_id);
CREATE INDEX IF NOT EXISTS event_assignments_user_id_idx ON public.event_assignments(user_id);
CREATE INDEX IF NOT EXISTS event_assignments_is_active_idx ON public.event_assignments(is_active);

-- Concurrency Partial Unique Index: Exactly ONE active COURT_MANAGER per event (Tournament/Event-wide)
CREATE UNIQUE INDEX IF NOT EXISTS single_active_court_manager_per_event_idx
  ON public.event_assignments (event_id)
  WHERE (role = 'COURT_MANAGER' AND is_active = TRUE);

-- Concurrency Partial Unique Index: Unique active assignment per event + court + user + role (TABLE_OFFICIAL)
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_assignment_per_event_court_user_role_idx
  ON public.event_assignments (event_id, court_id, user_id, role)
  WHERE (is_active = TRUE AND court_id IS NOT NULL);

-- Concurrency Partial Unique Index: Unique active assignment per event + user + role (COURT_MANAGER)
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_assignment_per_event_user_role_idx
  ON public.event_assignments (event_id, user_id, role)
  WHERE (is_active = TRUE AND court_id IS NULL);

-- 3. Trigger for Event / Court Tournament Alignment Verification
CREATE OR REPLACE FUNCTION public.check_event_court_tournament_alignment()
RETURNS TRIGGER AS $$
DECLARE
  v_event_tournament_id UUID;
  v_court_tournament_id UUID;
BEGIN
  -- If court_id is NULL (e.g. event-wide COURT_MANAGER), no court alignment check is required
  IF NEW.court_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve tournament_id for event via snapshot
  SELECT ts.tournament_id INTO v_event_tournament_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  WHERE e.id = NEW.event_id;

  IF v_event_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Event snapshot tournament reference not found for event %', NEW.event_id;
  END IF;

  -- Resolve tournament_id for court
  SELECT c.tournament_id INTO v_court_tournament_id
  FROM public.courts c
  WHERE c.id = NEW.court_id;

  IF v_court_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Court not found for court %', NEW.court_id;
  END IF;

  -- Enforce identical tournament
  IF v_event_tournament_id <> v_court_tournament_id THEN
    RAISE EXCEPTION 'Court % does not belong to the same tournament as event %', NEW.court_id, NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_check_event_court_alignment ON public.event_assignments;
CREATE TRIGGER tr_check_event_court_alignment
  BEFORE INSERT OR UPDATE OF event_id, court_id ON public.event_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_event_court_tournament_alignment();

-- 4. Enable Row Level Security (RLS) on public.event_assignments
ALTER TABLE public.event_assignments ENABLE ROW LEVEL SECURITY;

-- RLS SELECT Policy (Direct client SELECT)
DROP POLICY IF EXISTS event_assignments_select_policy ON public.event_assignments;
CREATE POLICY event_assignments_select_policy ON public.event_assignments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
      JOIN public.tournaments t ON t.id = ts.tournament_id
      WHERE e.id = event_assignments.event_id
        AND (t.organizer_id = auth.uid() OR t.status <> 'DRAFT')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN'::app_role, 'ADMIN'::app_role)
    )
  );

-- Direct client INSERT, UPDATE, DELETE policies:
-- DENIED BY DEFAULT via default-deny RLS. All mutations execute via protected SECURITY DEFINER RPCs below.

-- 5. RPC: assign_event_role
CREATE OR REPLACE FUNCTION public.assign_event_role(
  p_event_id UUID,
  p_user_id UUID,
  p_role event_role,
  p_court_id UUID DEFAULT NULL
)
RETURNS public.event_assignments AS $$
DECLARE
  v_requester_id UUID;
  v_target_status TEXT;
  v_tournament_id UUID;
  v_tournament_status tournament_status;
  v_organizer_id UUID;
  v_court_tournament_id UUID;
  v_is_super_or_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
  v_result public.event_assignments;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Prevent self-assignment
  IF p_user_id = v_requester_id THEN
    RAISE EXCEPTION 'Self-assignment of event operational roles is strictly prohibited.';
  END IF;

  -- Validate target user active account status
  SELECT account_status INTO v_target_status
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_target_status IS NULL OR v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Target user profile is not active.';
  END IF;

  -- Validate role-specific court_id constraints
  IF p_role = 'COURT_MANAGER'::event_role THEN
    IF p_court_id IS NOT NULL THEN
      RAISE EXCEPTION 'Court ID must be NULL for event-wide COURT_MANAGER assignment.';
    END IF;
  ELSIF p_role = 'TABLE_OFFICIAL'::event_role THEN
    IF p_court_id IS NULL THEN
      RAISE EXCEPTION 'Court ID is mandatory for TABLE_OFFICIAL assignment.';
    END IF;
  END IF;

  -- Resolve tournament and event status
  SELECT t.id, t.status, t.organizer_id INTO v_tournament_id, v_tournament_status, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Event or associated tournament not found.';
  END IF;

  -- Validate court belongs to event tournament (if court_id is provided)
  IF p_court_id IS NOT NULL THEN
    SELECT c.tournament_id INTO v_court_tournament_id
    FROM public.courts c
    WHERE c.id = p_court_id;

    IF v_court_tournament_id IS NULL OR v_court_tournament_id <> v_tournament_id THEN
      RAISE EXCEPTION 'Court does not belong to the event tournament.';
    END IF;
  END IF;

  -- Check Requester Permanent Role Privileges (READ ONLY on user_roles)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN'::app_role, 'ADMIN'::app_role)
  ) INTO v_is_super_or_admin;

  IF NOT v_is_super_or_admin AND v_organizer_id = v_requester_id THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_requester_id AND role = 'ORGANIZER'::app_role
    ) INTO v_is_organizer;
  END IF;

  -- AUTHORIZATION VERIFICATION
  IF v_is_super_or_admin OR v_is_organizer THEN
    -- Admin / Organizer permitted to assign COURT_MANAGER or TABLE_OFFICIAL
    NULL;
  ELSE
    -- Check if requester is active COURT_MANAGER for this exact event (event-wide)
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments
      WHERE user_id = v_requester_id
        AND event_id = p_event_id
        AND role = 'COURT_MANAGER'::event_role
        AND is_active = TRUE
    ) INTO v_is_court_manager;

    IF v_is_court_manager THEN
      -- Delegated COURT_MANAGER checks
      IF p_role = 'COURT_MANAGER'::event_role THEN
        RAISE EXCEPTION 'A COURT_MANAGER cannot assign another COURT_MANAGER.';
      END IF;

      IF p_role <> 'TABLE_OFFICIAL'::event_role THEN
        RAISE EXCEPTION 'A COURT_MANAGER can only assign TABLE_OFFICIAL personnel.';
      END IF;

      -- Check tournament lifecycle window for COURT_MANAGER delegated assignment
      IF v_tournament_status NOT IN ('BRACKET_GENERATION'::tournament_status, 'READY'::tournament_status, 'ONGOING'::tournament_status) THEN
        RAISE EXCEPTION 'Delegated COURT_MANAGER authority is permitted only during BRACKET_GENERATION, READY, or ONGOING stages.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unauthorized to assign event role for this event.';
    END IF;
  END IF;

  -- If assigning a new COURT_MANAGER, soft-revoke existing active COURT_MANAGER on this event (event-wide)
  IF p_role = 'COURT_MANAGER'::event_role THEN
    UPDATE public.event_assignments
    SET is_active = FALSE,
        revoked_at = NOW(),
        revoked_by = v_requester_id
    WHERE event_id = p_event_id
      AND role = 'COURT_MANAGER'::event_role
      AND is_active = TRUE;
  END IF;

  -- Soft-revoke any duplicate active identical assignment for user + role on this event (+ court if applicable)
  UPDATE public.event_assignments
  SET is_active = FALSE,
      revoked_at = NOW(),
      revoked_by = v_requester_id
  WHERE event_id = p_event_id
    AND (court_id IS NOT DISTINCT FROM p_court_id)
    AND user_id = p_user_id
    AND role = p_role
    AND is_active = TRUE;

  -- Insert new active event assignment
  INSERT INTO public.event_assignments (
    event_id,
    user_id,
    role,
    court_id,
    assigned_by,
    is_active
  )
  VALUES (
    p_event_id,
    p_user_id,
    p_role,
    p_court_id,
    v_requester_id,
    TRUE
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, event_role, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_event_role(UUID, UUID, event_role, UUID) TO authenticated;

-- 6. RPC: revoke_event_role
CREATE OR REPLACE FUNCTION public.revoke_event_role(
  p_assignment_id UUID
)
RETURNS public.event_assignments AS $$
DECLARE
  v_requester_id UUID;
  v_assignment public.event_assignments;
  v_tournament_id UUID;
  v_tournament_status tournament_status;
  v_organizer_id UUID;
  v_is_super_or_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
  v_result public.event_assignments;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Fetch active assignment target
  SELECT * INTO v_assignment
  FROM public.event_assignments
  WHERE id = p_assignment_id AND is_active = TRUE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Active event assignment not found.';
  END IF;

  -- Resolve tournament and status
  SELECT t.id, t.status, t.organizer_id INTO v_tournament_id, v_tournament_status, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = v_assignment.event_id;

  -- Check Requester Permanent Role Privileges (READ ONLY on user_roles)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN'::app_role, 'ADMIN'::app_role)
  ) INTO v_is_super_or_admin;

  IF NOT v_is_super_or_admin AND v_organizer_id = v_requester_id THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_requester_id AND role = 'ORGANIZER'::app_role
    ) INTO v_is_organizer;
  END IF;

  -- AUTHORIZATION VERIFICATION FOR REVOCATION
  IF v_is_super_or_admin OR v_is_organizer THEN
    -- Admin / Organizer permitted
    NULL;
  ELSE
    -- Check if requester is active COURT_MANAGER for this exact event (event-wide)
    SELECT EXISTS (
      SELECT 1 FROM public.event_assignments
      WHERE user_id = v_requester_id
        AND event_id = v_assignment.event_id
        AND role = 'COURT_MANAGER'::event_role
        AND is_active = TRUE
    ) INTO v_is_court_manager;

    IF v_is_court_manager THEN
      IF v_assignment.role = 'COURT_MANAGER'::event_role THEN
        RAISE EXCEPTION 'A COURT_MANAGER cannot revoke another COURT_MANAGER.';
      END IF;

      IF v_tournament_status NOT IN ('BRACKET_GENERATION'::tournament_status, 'READY'::tournament_status, 'ONGOING'::tournament_status) THEN
        RAISE EXCEPTION 'Delegated COURT_MANAGER authority is permitted only during BRACKET_GENERATION, READY, or ONGOING stages.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unauthorized to revoke event role.';
    END IF;
  END IF;

  -- Soft-revoke assignment
  UPDATE public.event_assignments
  SET is_active = FALSE,
      revoked_at = NOW(),
      revoked_by = v_requester_id
  WHERE id = p_assignment_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.revoke_event_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_event_role(UUID) TO authenticated;

