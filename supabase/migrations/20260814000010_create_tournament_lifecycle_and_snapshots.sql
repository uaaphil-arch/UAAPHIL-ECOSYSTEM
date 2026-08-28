-- Migration: 20260814000010_create_tournament_lifecycle_and_snapshots.sql
-- Description: Tournament Lifecycle Management, Atomic Immutable Snapshot Engine, and Competition State Locking
-- Target Domain: UAAPHIL Tournament System
-- Sequence: 000010 (Additive, Non-destructive, Preserves Migrations 000001-000009)

-- 1. Snapshot Immutability Enforcement Function and Trigger
-- Invariant: Tournament snapshots are strictly append-only and immutable.
-- Direct UPDATE or DELETE on existing tournament_snapshots records is strictly forbidden.
CREATE OR REPLACE FUNCTION public.enforce_tournament_snapshot_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Tournament snapshots are immutable and cannot be updated'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Tournament snapshots are immutable and cannot be deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tournament_snapshot_immutability ON public.tournament_snapshots;
CREATE TRIGGER trg_enforce_tournament_snapshot_immutability
  BEFORE UPDATE OR DELETE ON public.tournament_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tournament_snapshot_immutability();

-- 2. Indexes for tournament_snapshots and tournaments
CREATE INDEX IF NOT EXISTS idx_tournament_snapshots_tournament_id 
  ON public.tournament_snapshots(tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_snapshots_created_at 
  ON public.tournament_snapshots(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournaments_status 
  ON public.tournaments(status);

-- 3. RLS Policies for tournament_snapshots
-- Direct client INSERT is disabled. Snapshots must be generated exclusively via lock_and_snapshot_tournament() RPC.
ALTER TABLE public.tournament_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view tournament snapshots" ON public.tournament_snapshots;
CREATE POLICY "Public can view tournament snapshots"
  ON public.tournament_snapshots
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Admins can insert tournament snapshots" ON public.tournament_snapshots;
-- Note: Direct INSERT, UPDATE, DELETE policies omitted to enforce RPC-only creation pattern.

-- 4. RPC: get_tournament_snapshot
-- Publicly accessible retrieval of frozen tournament configuration
CREATE OR REPLACE FUNCTION public.get_tournament_snapshot(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_tournament_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'id', ts.id,
    'tournament_id', ts.tournament_id,
    'configuration', ts.configuration,
    'version', ts.version,
    'created_at', ts.created_at
  )
  INTO v_snapshot
  FROM public.tournament_snapshots ts
  WHERE ts.tournament_id = p_tournament_id
  ORDER BY ts.created_at DESC
  LIMIT 1;

  RETURN v_snapshot;
END;
$$;

-- 5. RPC: lock_and_snapshot_tournament
-- Super Admin / Admin atomic tournament snapshot generator, validator & state lock
CREATE OR REPLACE FUNCTION public.lock_and_snapshot_tournament(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_role TEXT;
  v_requester_status TEXT;
  v_tournament RECORD;
  v_events JSONB;
  v_registrations JSONB;
  v_courts JSONB;
  v_snapshot_payload JSONB;
  v_snapshot_id UUID;
  v_events_count INT;
  v_registrations_count INT;
  v_courts_count INT;
  v_next_version INT;
BEGIN
  -- 1. Requester Session Check
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Requester Role & Active Status Validation
  SELECT ur.role::text, p.status
  INTO v_requester_role, v_requester_status
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.id = v_requester_id
  AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
  LIMIT 1;

  IF v_requester_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN or ADMIN can snapshot tournaments'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester profile is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Lock Tournament Row with FOR UPDATE Concurrency Protection
  SELECT *
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Tournament does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Pre-Snapshot Validation: Start and End Dates
  IF v_tournament.start_date IS NULL OR v_tournament.end_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament start and end dates must be configured before snapshotting'
      USING ERRCODE = '22000';
  END IF;

  IF v_tournament.end_date < v_tournament.start_date THEN
    RAISE EXCEPTION 'INVALID_STATE: Tournament end date cannot be earlier than start date'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Aggregate Events & Registrations
  -- Query events and approved registrations
  SELECT 
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'gender', e.gender,
        'division', e.division,
        'category', e.category,
        'weight_class', e.weight_class,
        'created_at', e.created_at
      ) ORDER BY e.division, e.gender, e.name
    ), '[]'::jsonb),
    COUNT(e.id)
  INTO v_events, v_events_count
  FROM public.events e;

  IF v_events_count = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: At least 1 event must be configured before snapshotting'
      USING ERRCODE = '22000';
  END IF;

  -- 6. Aggregate Approved Registrations with Athlete Profiles
  SELECT 
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'event_id', r.event_id,
        'user_id', r.user_id,
        'team_name', r.team_name,
        'weigh_in_weight', r.weigh_in_weight,
        'is_approved', r.is_approved,
        'athlete_name', p.full_name,
        'athlete_email', p.email
      ) ORDER BY r.created_at
    ), '[]'::jsonb),
    COUNT(r.id)
  INTO v_registrations, v_registrations_count
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.is_approved = TRUE;

  IF v_registrations_count = 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: At least 1 approved athlete registration is required before snapshotting'
      USING ERRCODE = '22000';
  END IF;

  -- 7. Aggregate Configured Active Courts for Target Tournament
  SELECT 
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'tournament_id', c.tournament_id,
        'name', c.name,
        'identifier', c.identifier,
        'is_active', c.is_active
      ) ORDER BY c.identifier
    ), '[]'::jsonb),
    COUNT(c.id)
  INTO v_courts, v_courts_count
  FROM public.courts c
  WHERE c.tournament_id = p_tournament_id
  AND c.is_active = TRUE;

  -- 8. Calculate Next Snapshot Version (Atomic Sequence)
  SELECT COALESCE(MAX(version), 0) + 1
  INTO v_next_version
  FROM public.tournament_snapshots
  WHERE tournament_id = p_tournament_id;

  -- 9. Compile Complete Immutable Snapshot Payload
  v_snapshot_payload := jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'name', v_tournament.name,
      'status', v_tournament.status,
      'start_date', v_tournament.start_date,
      'end_date', v_tournament.end_date,
      'description', v_tournament.description
    ),
    'events', v_events,
    'registrations', v_registrations,
    'courts', v_courts,
    'metadata', jsonb_build_object(
      'events_count', v_events_count,
      'approved_registrations_count', v_registrations_count,
      'active_courts_count', v_courts_count,
      'snapshotted_by', v_requester_id,
      'snapshotted_by_role', v_requester_role,
      'snapshotted_at', timezone('utc'::text, now())
    )
  );

  -- 10. Insert Immutable Snapshot Record
  INSERT INTO public.tournament_snapshots (
    tournament_id,
    configuration,
    version,
    created_at
  ) VALUES (
    p_tournament_id,
    v_snapshot_payload,
    v_next_version,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_snapshot_id;

  -- 11. Transition Tournament Lifecycle Status to ONGOING if currently in DRAFT or REGISTRATION_CLOSED
  IF v_tournament.status IN ('DRAFT', 'REGISTRATION_CLOSED') THEN
    UPDATE public.tournaments
    SET 
      status = 'ONGOING',
      updated_at = timezone('utc'::text, now())
    WHERE id = p_tournament_id;
  END IF;

  -- 12. Write Immutable System Audit Log with Actual Resolved Role
  INSERT INTO public.system_audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  ) VALUES (
    v_requester_id,
    v_requester_role,
    'LOCK_TOURNAMENT_SNAPSHOT',
    'TOURNAMENT_SNAPSHOT',
    v_snapshot_id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'snapshot_id', v_snapshot_id,
      'version', v_next_version,
      'events_count', v_events_count,
      'registrations_count', v_registrations_count,
      'courts_count', v_courts_count
    ),
    timezone('utc'::text, now())
  );

  -- 13. Return Execution Summary
  RETURN jsonb_build_object(
    'success', TRUE,
    'snapshot_id', v_snapshot_id,
    'tournament_id', p_tournament_id,
    'version', v_next_version,
    'events_count', v_events_count,
    'registrations_count', v_registrations_count,
    'courts_count', v_courts_count,
    'created_at', timezone('utc'::text, now())
  );
END;
$$;

-- 6. Explicit Function Execution Grants
REVOKE ALL ON FUNCTION public.get_tournament_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_snapshot(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_snapshot(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_snapshot(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.lock_and_snapshot_tournament(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_and_snapshot_tournament(UUID) TO authenticated;
