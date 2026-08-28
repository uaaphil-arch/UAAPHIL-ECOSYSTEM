-- Migration: 20260827000050_create_batch_rotate_officials_rpc.sql
-- Description: Implement Atomic Batch Official Shift Rotation RPC (P7-03C)
--
-- P7-03C GOVERNANCE & INVARIANT ENFORCEMENT:
-- 1. INV-01: Zero offline auto-replay; requires live authoritative transaction.
-- 2. INV-02: PostgreSQL is the sole source of truth; all-or-nothing atomicity.
-- 3. INV-04: Strict server-side RBAC (SUPER_ADMIN, ADMIN, ORGANIZER, active COURT_MANAGER).
-- 4. INV-05: Table official authority remains strictly court-scoped.
-- 5. INV-06: Cross-tournament isolation (tournament derived server-side from event).
-- 6. INV-07: Concurrency & idempotency protected via sorted row locks (FOR UPDATE).
-- 7. INV-08: Active-bout safety (fails closed if any targeted court has a LIVE match).
-- 8. INV-09: Append-only audit integrity & non-destructive assignment history.

-- -----------------------------------------------------------------------------
-- 0. Safe drop existing function definition to prevent signature conflicts
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.batch_rotate_officials(UUID, JSONB);

-- -----------------------------------------------------------------------------
-- 1. RPC: public.batch_rotate_officials
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_rotate_officials(
  p_event_id UUID,
  p_rotations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_status public.account_status;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_is_organizer BOOLEAN := FALSE;
  v_is_court_manager BOOLEAN := FALSE;
  v_resolved_tournament_id UUID;
  v_organizer_id UUID;
  v_rotation_count INT;
  v_item JSONB;
  v_row RECORD;
  v_court_id UUID;
  v_court_name TEXT;
  v_court_identifier TEXT;
  v_existing_assignment RECORD;
  v_incoming_status public.account_status;
  v_active_bout RECORD;
  v_rotated_courts UUID[] := ARRAY[]::UUID[];
  v_duplicate_check_count INT;
BEGIN
  -- 1. Authenticate Requester
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required.' USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Requester Account Status
  SELECT p.account_status
  INTO v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF v_requester_status IS NULL OR v_requester_status <> 'ACTIVE'::public.account_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester account is not active.' USING ERRCODE = '40300';
  END IF;

  -- 3. Resolve Event, Tournament, and Organizer Server-Side (INV-06)
  SELECT ts.tournament_id, t.organizer_id
  INTO v_resolved_tournament_id, v_organizer_id
  FROM public.events e
  JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE e.id = p_event_id;

  IF v_resolved_tournament_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Competition event % does not exist.', p_event_id USING ERRCODE = '40400';
  END IF;

  -- 4. Evaluate Server-Side Requester Authority (INV-04)
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'SUPER_ADMIN'::public.app_role),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_requester_id AND ur.role = 'ADMIN'::public.app_role)
  INTO v_is_super_admin, v_is_admin;

  IF v_organizer_id = v_requester_id AND EXISTS (
    SELECT 1 FROM public.user_roles ur 
    WHERE ur.user_id = v_requester_id AND ur.role IN ('ORGANIZER'::public.app_role, 'ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role)
  ) THEN
    v_is_organizer := TRUE;
  END IF;

  -- Check if requester is an active COURT_MANAGER for this event
  SELECT EXISTS (
    SELECT 1 FROM public.event_assignments ea
    WHERE ea.event_id = p_event_id
      AND ea.user_id = v_requester_id
      AND ea.role = 'COURT_MANAGER'::public.event_role
      AND ea.court_id IS NULL
      AND ea.is_active = TRUE
  ) INTO v_is_court_manager;

  -- Authorization Gate: Fail-closed if not authorized
  IF NOT (v_is_super_admin OR v_is_admin OR v_is_organizer OR v_is_court_manager) THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to perform batch official shift rotation.' USING ERRCODE = '40300';
  END IF;

  -- 5. Validate JSON Payload Structure
  IF p_rotations IS NULL OR jsonb_typeof(p_rotations) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Rotations payload must be a JSON array.' USING ERRCODE = '40001';
  END IF;

  v_rotation_count := jsonb_array_length(p_rotations);
  IF v_rotation_count = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Rotations array cannot be empty.' USING ERRCODE = '40002';
  END IF;

  IF v_rotation_count > 16 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Batch size % exceeds maximum limit of 16 rotations.', v_rotation_count USING ERRCODE = '40003';
  END IF;

  -- 6. Validate Field Presence and Format in All Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rotations)
  LOOP
    IF v_item->>'court_id' IS NULL 
       OR v_item->>'outgoing_assignment_id' IS NULL 
       OR v_item->>'outgoing_user_id' IS NULL 
       OR v_item->>'incoming_user_id' IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Each rotation item must contain court_id, outgoing_assignment_id, outgoing_user_id, and incoming_user_id.' USING ERRCODE = '40004';
    END IF;

    -- Prevent self-rotation (no-op)
    IF (v_item->>'outgoing_user_id') = (v_item->>'incoming_user_id') THEN
      RAISE EXCEPTION 'NO_OP_ROTATION: Outgoing official and incoming official are identical for court %.', v_item->>'court_id' USING ERRCODE = '40005';
    END IF;
  END LOOP;

  -- 7. Validate No Duplicate Courts in Payload
  SELECT COUNT(*) INTO v_duplicate_check_count
  FROM (
    SELECT (x.court_id)::UUID AS cid 
    FROM jsonb_to_recordset(p_rotations) AS x(court_id TEXT)
    GROUP BY cid HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicate_check_count > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_COURT: A court cannot appear more than once in a single batch rotation.' USING ERRCODE = '40006';
  END IF;

  -- 8. Validate No Duplicate Incoming Officials in Payload
  SELECT COUNT(*) INTO v_duplicate_check_count
  FROM (
    SELECT (x.incoming_user_id)::UUID AS iuid 
    FROM jsonb_to_recordset(p_rotations) AS x(incoming_user_id TEXT)
    GROUP BY iuid HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicate_check_count > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_INCOMING_OFFICIAL: An incoming official cannot be assigned to multiple courts in the same batch.' USING ERRCODE = '40007';
  END IF;

  -- 9. Iterate Through Rotations in Deterministic Sorted Order (INV-07 Concurrency / Deadlock Prevention)
  FOR v_row IN 
    SELECT 
      (x.court_id)::UUID AS court_id,
      (x.outgoing_assignment_id)::UUID AS outgoing_assignment_id,
      (x.outgoing_user_id)::UUID AS outgoing_user_id,
      (x.incoming_user_id)::UUID AS incoming_user_id
    FROM jsonb_to_recordset(p_rotations) AS x(
      court_id TEXT,
      outgoing_assignment_id TEXT,
      outgoing_user_id TEXT,
      incoming_user_id TEXT
    )
    ORDER BY (x.court_id)::UUID ASC
  LOOP
    -- A. Verify Court Exists and Belongs to Event Tournament (INV-06)
    SELECT c.id, c.name, c.identifier 
    INTO v_court_id, v_court_name, v_court_identifier
    FROM public.courts c
    WHERE c.id = v_row.court_id 
      AND c.tournament_id = v_resolved_tournament_id 
      AND c.is_active = TRUE;

    IF v_court_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_COURT: Court % does not exist, is inactive, or belongs to a different tournament.', v_row.court_id USING ERRCODE = '40008';
    END IF;

    -- B. Verify and Lock Outgoing Assignment (INV-07)
    SELECT ea.* INTO v_existing_assignment
    FROM public.event_assignments ea
    WHERE ea.id = v_row.outgoing_assignment_id
    FOR UPDATE;

    IF v_existing_assignment.id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: Outgoing assignment % does not exist.', v_row.outgoing_assignment_id USING ERRCODE = '40401';
    END IF;

    IF NOT v_existing_assignment.is_active THEN
      RAISE EXCEPTION 'STALE_ASSIGNMENT: Outgoing assignment % is already inactive/revoked.', v_row.outgoing_assignment_id USING ERRCODE = '40903';
    END IF;

    IF v_existing_assignment.event_id <> p_event_id THEN
      RAISE EXCEPTION 'CROSS_EVENT_MISMATCH: Outgoing assignment % belongs to a different event.', v_row.outgoing_assignment_id USING ERRCODE = '40009';
    END IF;

    IF v_existing_assignment.court_id <> v_row.court_id THEN
      RAISE EXCEPTION 'COURT_MISMATCH: Outgoing assignment % is assigned to court %, not target court %.', v_row.outgoing_assignment_id, v_existing_assignment.court_id, v_row.court_id USING ERRCODE = '40010';
    END IF;

    IF v_existing_assignment.user_id <> v_row.outgoing_user_id THEN
      RAISE EXCEPTION 'USER_MISMATCH: Outgoing assignment % belongs to official %, not expected %.', v_row.outgoing_assignment_id, v_existing_assignment.user_id, v_row.outgoing_user_id USING ERRCODE = '40011';
    END IF;

    IF v_existing_assignment.role <> 'TABLE_OFFICIAL'::public.event_role THEN
      RAISE EXCEPTION 'INVALID_ROLE: Batch rotation only supports TABLE_OFFICIAL assignments; encountered %.', v_existing_assignment.role USING ERRCODE = '40012';
    END IF;

    -- C. Validate Incoming Official Profile & Account Status
    SELECT p.account_status INTO v_incoming_status
    FROM public.profiles p
    WHERE p.id = v_row.incoming_user_id;

    IF v_incoming_status IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: Incoming official profile % does not exist.', v_row.incoming_user_id USING ERRCODE = '40402';
    END IF;

    IF v_incoming_status <> 'ACTIVE'::public.account_status THEN
      RAISE EXCEPTION 'INVALID_TARGET: Incoming official profile % is not active (status: %).', v_row.incoming_user_id, v_incoming_status USING ERRCODE = '40013';
    END IF;

    -- D. Check Incoming Official Not Already Active on this Court/Event
    IF EXISTS (
      SELECT 1 FROM public.event_assignments ea
      WHERE ea.event_id = p_event_id
        AND ea.court_id = v_row.court_id
        AND ea.user_id = v_row.incoming_user_id
        AND ea.role = 'TABLE_OFFICIAL'::public.event_role
        AND ea.is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT: Incoming official % is already actively assigned to court %.', v_row.incoming_user_id, v_row.court_id USING ERRCODE = '40901';
    END IF;

    -- E. CRITICAL ACTIVE-BOUT SAFETY GATE (INV-08 Fail-Closed)
    SELECT ca.id, ca.match_id, m.match_number
    INTO v_active_bout
    FROM public.court_assignments ca
    LEFT JOIN public.matches m ON m.id = ca.match_id
    WHERE ca.court_id = v_row.court_id
      AND (
        ca.status = 'LIVE'::public.assignment_status 
        OR (m.status IS NOT NULL AND m.status = 'IN_PROGRESS'::public.match_status)
      )
    LIMIT 1;

    IF v_active_bout.id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_BOUT_IN_PROGRESS: Cannot rotate Table Officials while % has an active LIVE match (Match #%). Wait until the match concludes.', 
        COALESCE(v_court_name, 'Court ' || v_court_identifier, v_row.court_id::text),
        COALESCE(v_active_bout.match_number::text, 'LIVE')
        USING ERRCODE = '40902';
    END IF;

    -- F. Non-Destructive Revocation of Outgoing Assignment (INV-09)
    UPDATE public.event_assignments
    SET is_active = FALSE,
        revoked_at = NOW(),
        revoked_by = v_requester_id
    WHERE id = v_row.outgoing_assignment_id;

    -- G. Insert New Incoming Assignment (INV-05 / INV-09)
    INSERT INTO public.event_assignments (
      event_id,
      user_id,
      role,
      court_id,
      assigned_by,
      is_active,
      created_at
    ) VALUES (
      p_event_id,
      v_row.incoming_user_id,
      'TABLE_OFFICIAL'::public.event_role,
      v_row.court_id,
      v_requester_id,
      TRUE,
      NOW()
    );

    v_rotated_courts := array_append(v_rotated_courts, v_row.court_id);
  END LOOP;

  -- 10. Record Structured Audit Entry in system_audit_logs if table exists (INV-09)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_audit_logs') THEN
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
      v_requester_id,
      CASE 
        WHEN v_is_super_admin THEN 'SUPER_ADMIN'
        WHEN v_is_admin THEN 'ADMIN'
        WHEN v_is_organizer THEN 'ORGANIZER'
        ELSE 'COURT_MANAGER'
      END,
      'BATCH_OFFICIAL_SHIFT_ROTATION',
      'EVENT',
      p_event_id,
      v_resolved_tournament_id,
      jsonb_build_object(
        'event_id', p_event_id,
        'rotated_count', array_length(v_rotated_courts, 1),
        'rotated_courts', to_jsonb(v_rotated_courts),
        'timestamp', NOW()
      ),
      NOW()
    );
  END IF;

  -- 11. Return Authoritative Success Payload
  RETURN jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'tournament_id', v_resolved_tournament_id,
    'rotated_count', array_length(v_rotated_courts, 1),
    'rotated_courts', to_jsonb(v_rotated_courts),
    'executed_at', NOW()
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Grants & Execution Permissions
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.batch_rotate_officials(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.batch_rotate_officials(UUID, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.batch_rotate_officials(UUID, JSONB) FROM anon;
