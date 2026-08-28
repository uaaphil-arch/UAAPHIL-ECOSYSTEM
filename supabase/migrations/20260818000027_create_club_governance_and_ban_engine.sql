-- Migration: 20260818000027_create_club_governance_and_ban_engine.sql
-- Domain: Club Governance, Temporal Ban Control, Archival, Safety-Guarded Permanent Deletion, and System Audit Logging
-- Sequence: 000027 (Additive, Non-destructive, Preserves Migrations 000001-000026)

-- ====================================================================
-- 1. ADDITIVE COLUMNS ON PUBLIC.CLUBS
-- ====================================================================

DO $$
BEGIN
  -- 1a. governance_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'governance_status'
  ) THEN
    ALTER TABLE public.clubs 
      ADD COLUMN governance_status TEXT NOT NULL DEFAULT 'ACTIVE' 
      CHECK (governance_status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'));
  END IF;

  -- 1b. ban fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'banned_at'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN banned_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'ban_until'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN ban_until TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'banned_by'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN banned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'ban_reason'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN ban_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'ban_notes'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN ban_notes TEXT;
  END IF;

  -- 1c. archive fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'archived_at'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN archived_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'archived_by'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'archive_reason'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN archive_reason TEXT;
  END IF;
END $$;

-- Indexes for governance lookup
CREATE INDEX IF NOT EXISTS idx_clubs_governance_status ON public.clubs(governance_status);
CREATE INDEX IF NOT EXISTS idx_clubs_ban_until ON public.clubs(ban_until) WHERE governance_status = 'SUSPENDED';

-- ====================================================================
-- 2. HELPER FUNCTION: evaluate_club_ban_expiry
-- Checks if a suspension has temporally expired; restores if so.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.evaluate_club_ban_expiry(p_club_id UUID)
RETURNS public.clubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_club public.clubs;
BEGIN
  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- If SUSPENDED and ban_until has passed, automatically restore to ACTIVE
  IF v_club.governance_status = 'SUSPENDED' 
     AND v_club.ban_until IS NOT NULL 
     AND NOW() >= v_club.ban_until THEN
    
    UPDATE public.clubs
    SET 
      governance_status = 'ACTIVE',
      is_active = TRUE,
      ban_notes = COALESCE(ban_notes, '') || ' [Auto-restored on expiration: ' || NOW()::TEXT || ']',
      updated_at = timezone('utc'::text, now())
    WHERE id = p_club_id
    RETURNING * INTO v_club;

    -- Audit log auto-restoration
    INSERT INTO public.system_audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    ) VALUES (
      NULL,
      'SYSTEM',
      'AUTO_RESTORE_CLUB',
      'CLUB',
      p_club_id,
      jsonb_build_object(
        'reason', 'Temporary suspension duration elapsed',
        'expired_ban_until', v_club.ban_until,
        'club_name', v_club.name
      ),
      NOW()
    );
  END IF;

  RETURN v_club;
END;
$$;

-- ====================================================================
-- 3. RPC: suspend_club (SUPER_ADMIN ONLY)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.suspend_club(
  p_club_id UUID,
  p_duration_days INT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_club_name TEXT;
  v_ban_until TIMESTAMPTZ;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 1. Super Admin Authorization
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Super Admin authority required to suspend or ban clubs'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Verify Club exists
  SELECT name INTO v_club_name
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;

  IF v_club_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 3. Calculate ban_until
  IF p_duration_days IS NOT NULL AND p_duration_days > 0 THEN
    v_ban_until := timezone('utc'::text, now()) + (p_duration_days * INTERVAL '1 day');
  ELSE
    v_ban_until := NULL; -- Indefinite
  END IF;

  -- 4. Update Club State
  UPDATE public.clubs
  SET 
    governance_status = 'SUSPENDED',
    is_active = FALSE,
    banned_at = timezone('utc'::text, now()),
    ban_until = v_ban_until,
    banned_by = v_requester_id,
    ban_reason = NULLIF(TRIM(p_reason), ''),
    ban_notes = NULLIF(TRIM(p_notes), ''),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_club_id;

  -- 5. Audit Log
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
    'SUPER_ADMIN',
    'SUSPEND_CLUB',
    'CLUB',
    p_club_id,
    jsonb_build_object(
      'club_name', v_club_name,
      'duration_days', p_duration_days,
      'ban_until', v_ban_until,
      'reason', p_reason,
      'notes', p_notes
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'club_id', p_club_id,
    'club_name', v_club_name,
    'governance_status', 'SUSPENDED',
    'ban_until', v_ban_until
  );
END;
$$;

-- ====================================================================
-- 4. RPC: restore_club (SUPER_ADMIN & ADMIN)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.restore_club(
  p_club_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_has_admin_role BOOLEAN;
  v_club_name TEXT;
  v_prev_status TEXT;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 1. Verify Admin / Super Admin Authorization
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_has_admin_role;

  IF NOT v_has_admin_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Administrative authority required to restore clubs'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Verify Club exists
  SELECT name, governance_status INTO v_club_name, v_prev_status
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;

  IF v_club_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 3. Restore Club
  UPDATE public.clubs
  SET 
    governance_status = 'ACTIVE',
    is_active = TRUE,
    ban_until = NULL,
    banned_at = NULL,
    banned_by = NULL,
    ban_reason = NULL,
    ban_notes = CASE 
      WHEN p_notes IS NOT NULL THEN 'Restored: ' || TRIM(p_notes)
      ELSE 'Restored to active status'
    END,
    archived_at = NULL,
    archived_by = NULL,
    archive_reason = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_club_id;

  -- 4. Audit Log
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
    'ADMIN',
    'RESTORE_CLUB',
    'CLUB',
    p_club_id,
    jsonb_build_object(
      'club_name', v_club_name,
      'previous_status', v_prev_status,
      'notes', p_notes
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'club_id', p_club_id,
    'club_name', v_club_name,
    'governance_status', 'ACTIVE'
  );
END;
$$;

-- ====================================================================
-- 5. RPC: archive_club (SUPER_ADMIN ONLY)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.archive_club(
  p_club_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_club_name TEXT;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 1. Super Admin Authorization
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Super Admin authority required to archive clubs'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Verify Club exists
  SELECT name INTO v_club_name
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;

  IF v_club_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 3. Archive Club
  UPDATE public.clubs
  SET 
    governance_status = 'ARCHIVED',
    is_active = FALSE,
    archived_at = timezone('utc'::text, now()),
    archived_by = v_requester_id,
    archive_reason = NULLIF(TRIM(p_reason), ''),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_club_id;

  -- 4. Audit Log
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
    'SUPER_ADMIN',
    'ARCHIVE_CLUB',
    'CLUB',
    p_club_id,
    jsonb_build_object(
      'club_name', v_club_name,
      'reason', p_reason
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'club_id', p_club_id,
    'club_name', v_club_name,
    'governance_status', 'ARCHIVED'
  );
END;
$$;

-- ====================================================================
-- 6. RPC: check_club_deletion_safety (SUPER_ADMIN ONLY)
-- Inspects all historical foreign keys & dependencies
-- ====================================================================

CREATE OR REPLACE FUNCTION public.check_club_deletion_safety(p_club_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_club_name TEXT;
  v_coaches_count INT := 0;
  v_memberships_count INT := 0;
  v_transfers_count INT := 0;
  v_successions_count INT := 0;
  v_registrations_count INT := 0;
  v_can_delete BOOLEAN := TRUE;
  v_reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Super Admin authority required'
      USING ERRCODE = '40300';
  END IF;

  SELECT name INTO v_club_name FROM public.clubs WHERE id = p_club_id;
  IF v_club_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club does not exist' USING ERRCODE = '40400';
  END IF;

  -- Check Dependencies
  SELECT COUNT(*) INTO v_coaches_count FROM public.club_coaches WHERE club_id = p_club_id;
  SELECT COUNT(*) INTO v_memberships_count FROM public.club_memberships WHERE club_id = p_club_id;
  SELECT COUNT(*) INTO v_transfers_count FROM public.player_transfer_requests WHERE from_club_id = p_club_id OR to_club_id = p_club_id;
  SELECT COUNT(*) INTO v_successions_count FROM public.coach_succession_requests WHERE club_id = p_club_id;
  SELECT COUNT(*) INTO v_registrations_count FROM public.registrations WHERE team_name ILIKE v_club_name;

  IF v_coaches_count > 0 THEN
    v_can_delete := FALSE;
    v_reasons := array_append(v_reasons, v_coaches_count || ' coach assignment record(s)');
  END IF;
  IF v_memberships_count > 0 THEN
    v_can_delete := FALSE;
    v_reasons := array_append(v_reasons, v_memberships_count || ' athlete membership record(s)');
  END IF;
  IF v_transfers_count > 0 THEN
    v_can_delete := FALSE;
    v_reasons := array_append(v_reasons, v_transfers_count || ' player transfer record(s)');
  END IF;
  IF v_successions_count > 0 THEN
    v_can_delete := FALSE;
    v_reasons := array_append(v_reasons, v_successions_count || ' coach succession record(s)');
  END IF;
  IF v_registrations_count > 0 THEN
    v_can_delete := FALSE;
    v_reasons := array_append(v_reasons, v_registrations_count || ' tournament athlete registration(s)');
  END IF;

  RETURN jsonb_build_object(
    'can_delete', v_can_delete,
    'club_id', p_club_id,
    'club_name', v_club_name,
    'dependencies', jsonb_build_object(
      'coaches', v_coaches_count,
      'memberships', v_memberships_count,
      'transfers', v_transfers_count,
      'successions', v_successions_count,
      'registrations', v_registrations_count
    ),
    'blocking_reasons', v_reasons,
    'recommendation', CASE 
      WHEN v_can_delete THEN 'Safe to permanently delete (zero historical records).'
      ELSE 'This Club/Team cannot be permanently deleted because it contains historical records. Archive the Club instead.'
    END
  );
END;
$$;

-- ====================================================================
-- 7. RPC: delete_club_permanently (SUPER_ADMIN ONLY)
-- Strictly blocked if dependencies exist
-- ====================================================================

CREATE OR REPLACE FUNCTION public.delete_club_permanently(
  p_club_id UUID,
  p_confirmed_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_super_admin BOOLEAN;
  v_club_name TEXT;
  v_safety_check JSONB;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 1. Super Admin Authorization
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Super Admin authority required to permanently delete clubs'
      USING ERRCODE = '40300';
  END IF;

  -- 2. Verify Club exists
  SELECT name INTO v_club_name
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;

  IF v_club_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club does not exist'
      USING ERRCODE = '40400';
  END IF;

  -- 3. Exact Name Confirmation Match
  IF TRIM(COALESCE(p_confirmed_name, '')) <> TRIM(v_club_name) THEN
    RAISE EXCEPTION 'CONFIRMATION_MISMATCH: Typed confirmation name does not match exact club name'
      USING ERRCODE = '42201';
  END IF;

  -- 4. Execute Dependency Check
  v_safety_check := public.check_club_deletion_safety(p_club_id);
  IF (v_safety_check->>'can_delete')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'PROTECTED_DEPENDENCY: This Club/Team cannot be permanently deleted because it contains historical records. Archive the Club instead.'
      USING ERRCODE = '42200';
  END IF;

  -- 5. Delete empty club row
  DELETE FROM public.clubs WHERE id = p_club_id;

  -- 6. Audit Log
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
    'SUPER_ADMIN',
    'PERMANENT_DELETE_CLUB',
    'CLUB',
    p_club_id,
    jsonb_build_object(
      'deleted_club_name', v_club_name,
      'confirmed_by_user', v_requester_id
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', 'PERMANENTLY_DELETED',
    'club_id', p_club_id,
    'club_name', v_club_name
  );
END;
$$;

-- ====================================================================
-- 8. PERMISSIONS & GRANTS
-- ====================================================================

REVOKE ALL ON FUNCTION public.suspend_club(UUID, INT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_club(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_club(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_club_deletion_safety(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_club_permanently(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evaluate_club_ban_expiry(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.suspend_club(UUID, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_club(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_club(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_club_deletion_safety(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_club_permanently(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_club_ban_expiry(UUID) TO authenticated;
