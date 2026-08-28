-- Migration: 20260830000055_create_chat_moderation_rpcs_and_audit.sql
-- Domain: Native Chat Moderation Security Definer RPCs (restrict_chat_user, revoke_chat_restriction)
--         and Immutable System Audit Logging.

-- -----------------------------------------------------------------------------
-- 1. RPC: restrict_chat_user
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restrict_chat_user(
  p_target_user_id UUID,
  p_restriction_type TEXT,
  p_scope TEXT,
  p_tournament_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL
)
RETURNS public.chat_user_restrictions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_is_super_admin BOOLEAN := FALSE;
  v_actor_is_admin BOOLEAN := FALSE;
  v_actor_is_organizer BOOLEAN := FALSE;
  v_actor_role_label TEXT;
  
  v_target_status TEXT;
  v_target_is_super_admin BOOLEAN := FALSE;
  v_target_is_admin BOOLEAN := FALSE;
  v_target_is_organizer BOOLEAN := FALSE;

  v_tournament_organizer_id UUID;
  v_expires_at TIMESTAMPTZ := NULL;
  v_existing_restriction_id UUID;
  v_new_restriction_id UUID;
  v_result public.chat_user_restrictions;
BEGIN
  -- 1. Authenticate Actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Target User
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Target user ID is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'SELF_RESTRICTION_FORBIDDEN: Moderators cannot restrict themselves'
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_target_status
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target profile does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'USER_INACTIVE: Target user account status is not ACTIVE'
      USING ERRCODE = '42202';
  END IF;

  -- 3. Validate Restriction Type
  IF p_restriction_type NOT IN ('BAN', 'MUTE', 'TIMEOUT') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid restriction_type (must be BAN, MUTE, or TIMEOUT)'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate Scope
  IF p_scope NOT IN ('GLOBAL', 'TOURNAMENT', 'ALL_CHAT') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid scope (must be GLOBAL, TOURNAMENT, or ALL_CHAT)'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Validate Reason
  IF p_reason IS NULL OR char_length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(p_reason) > 500 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Reason must not exceed 500 characters'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Enforce Scope vs Tournament Invariant
  IF p_scope = 'TOURNAMENT' THEN
    IF p_tournament_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: tournament_id is required for TOURNAMENT scope'
        USING ERRCODE = '22023';
    END IF;

    SELECT organizer_id INTO v_tournament_organizer_id
    FROM public.tournaments
    WHERE id = p_tournament_id;

    IF v_tournament_organizer_id IS NULL THEN
      RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND: Target tournament does not exist'
        USING ERRCODE = '40400';
    END IF;
  ELSE
    IF p_tournament_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: tournament_id must be NULL for GLOBAL or ALL_CHAT scope'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 7. Calculate Duration & Expiration
  IF p_restriction_type = 'TIMEOUT' THEN
    IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: TIMEOUT restriction requires a positive duration_minutes'
        USING ERRCODE = '22023';
    END IF;

    IF p_duration_minutes > 525600 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: TIMEOUT duration cannot exceed 525600 minutes (1 year)'
        USING ERRCODE = '22023';
    END IF;

    v_expires_at := timezone('utc'::text, now()) + (p_duration_minutes * INTERVAL '1 minute');
  ELSIF p_restriction_type IN ('BAN', 'MUTE') THEN
    IF p_duration_minutes IS NOT NULL AND p_duration_minutes > 0 THEN
      IF p_duration_minutes > 525600 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: duration_minutes cannot exceed 525600 minutes (1 year)'
          USING ERRCODE = '22023';
      END IF;
      v_expires_at := timezone('utc'::text, now()) + (p_duration_minutes * INTERVAL '1 minute');
    ELSE
      v_expires_at := NULL; -- Indefinite / Permanent
    END IF;
  END IF;

  -- 8. Resolve Actor Roles
  v_actor_is_super_admin := public.is_super_admin(v_actor_id);
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_actor_id AND role = 'ADMIN'::public.app_role
  ) INTO v_actor_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_actor_id AND role = 'ORGANIZER'::public.app_role
  ) INTO v_actor_is_organizer;

  -- 9. Resolve Target Roles
  v_target_is_super_admin := public.is_super_admin(p_target_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = p_target_user_id AND role = 'ADMIN'::public.app_role
  ) INTO v_target_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = p_target_user_id AND role = 'ORGANIZER'::public.app_role
  ) INTO v_target_is_organizer;

  -- 10. Enforce Hierarchy & Scope Authorization
  IF v_target_is_super_admin THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Super Administrators cannot be restricted'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_is_super_admin THEN
    v_actor_role_label := 'SUPER_ADMIN';
  ELSIF v_actor_is_admin THEN
    IF v_target_is_admin THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Administrators cannot restrict fellow Administrators'
        USING ERRCODE = '42501';
    END IF;
    v_actor_role_label := 'ADMIN';
  ELSIF v_actor_is_organizer THEN
    IF v_target_is_admin OR v_target_is_organizer THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Tournament Organizers cannot restrict Administrators or Organizers'
        USING ERRCODE = '42501';
    END IF;

    IF p_scope <> 'TOURNAMENT' THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Tournament Organizers may only restrict participants within the TOURNAMENT scope'
        USING ERRCODE = '42501';
    END IF;

    IF v_tournament_organizer_id <> v_actor_id THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Tournament Organizers may only restrict participants in their own tournaments'
        USING ERRCODE = '42501';
    END IF;

    v_actor_role_label := 'ORGANIZER';
  ELSE
    RAISE EXCEPTION 'PERMISSION_DENIED: Insufficient privileges to issue chat restrictions'
      USING ERRCODE = '42501';
  END IF;

  -- 11. Check Existing Active Restriction
  SELECT id INTO v_existing_restriction_id
  FROM public.chat_user_restrictions
  WHERE user_id = p_target_user_id
    AND scope = p_scope
    AND COALESCE(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_tournament_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND is_active = TRUE;

  IF v_existing_restriction_id IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_RESTRICTION: User already has an active restriction in this scope'
      USING ERRCODE = '23505';
  END IF;

  -- 12. Insert Restriction Record
  INSERT INTO public.chat_user_restrictions (
    user_id,
    restriction_type,
    scope,
    tournament_id,
    reason,
    restricted_by,
    restricted_at,
    expires_at,
    is_active
  ) VALUES (
    p_target_user_id,
    p_restriction_type,
    p_scope,
    p_tournament_id,
    trim(p_reason),
    v_actor_id,
    timezone('utc'::text, now()),
    v_expires_at,
    TRUE
  )
  RETURNING id INTO v_new_restriction_id;

  -- 13. Emit Immutable System Audit Log
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
    v_actor_id,
    v_actor_role_label,
    'CHAT_RESTRICTION_CREATED',
    'CHAT_USER_RESTRICTION',
    v_new_restriction_id,
    p_tournament_id,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'restriction_type', p_restriction_type,
      'scope', p_scope,
      'tournament_id', p_tournament_id,
      'reason', trim(p_reason),
      'duration_minutes', p_duration_minutes,
      'expires_at', v_expires_at,
      'restricted_by', v_actor_id
    ),
    timezone('utc'::text, now())
  );

  -- 14. Authenticated Read & Return
  SELECT * INTO v_result
  FROM public.chat_user_restrictions
  WHERE id = v_new_restriction_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restrict_chat_user(UUID, TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. RPC: revoke_chat_restriction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_chat_restriction(
  p_restriction_id UUID,
  p_revocation_reason TEXT DEFAULT NULL
)
RETURNS public.chat_user_restrictions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_is_super_admin BOOLEAN := FALSE;
  v_actor_is_admin BOOLEAN := FALSE;
  v_actor_is_organizer BOOLEAN := FALSE;
  v_actor_role_label TEXT;

  v_restriction public.chat_user_restrictions;
  v_tournament_organizer_id UUID;
  v_result public.chat_user_restrictions;
BEGIN
  -- 1. Authenticate Actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication session required'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Parameters
  IF p_restriction_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: restriction_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_revocation_reason IS NULL OR char_length(trim(p_revocation_reason)) = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Revocation reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(p_revocation_reason) > 500 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Revocation reason must not exceed 500 characters'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Load Target Restriction
  SELECT * INTO v_restriction
  FROM public.chat_user_restrictions
  WHERE id = p_restriction_id;

  IF v_restriction.id IS NULL THEN
    RAISE EXCEPTION 'RESTRICTION_NOT_FOUND: Chat restriction does not exist'
      USING ERRCODE = '40400';
  END IF;

  IF v_restriction.is_active = FALSE THEN
    RAISE EXCEPTION 'RESTRICTION_ALREADY_INACTIVE: This restriction has already been revoked'
      USING ERRCODE = '42202';
  END IF;

  -- 4. Resolve Actor Roles
  v_actor_is_super_admin := public.is_super_admin(v_actor_id);
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_actor_id AND role = 'ADMIN'::public.app_role
  ) INTO v_actor_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_actor_id AND role = 'ORGANIZER'::public.app_role
  ) INTO v_actor_is_organizer;

  -- 5. Enforce Hierarchy & Revocation Authority
  IF v_actor_is_super_admin THEN
    v_actor_role_label := 'SUPER_ADMIN';
  ELSIF v_actor_is_admin THEN
    v_actor_role_label := 'ADMIN';
  ELSIF v_actor_is_organizer THEN
    IF v_restriction.scope <> 'TOURNAMENT' OR v_restriction.tournament_id IS NULL THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Tournament Organizers may only revoke restrictions in their own tournament'
        USING ERRCODE = '42501';
    END IF;

    SELECT organizer_id INTO v_tournament_organizer_id
    FROM public.tournaments
    WHERE id = v_restriction.tournament_id;

    IF v_tournament_organizer_id <> v_actor_id THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Tournament Organizers cannot revoke restrictions for tournaments they do not own'
        USING ERRCODE = '42501';
    END IF;

    v_actor_role_label := 'ORGANIZER';
  ELSE
    RAISE EXCEPTION 'PERMISSION_DENIED: Insufficient privileges to revoke chat restrictions'
      USING ERRCODE = '42501';
  END IF;

  -- 6. Update Restriction Record (Soft Revocation)
  UPDATE public.chat_user_restrictions
  SET is_active = FALSE,
      revoked_at = timezone('utc'::text, now()),
      revoked_by = v_actor_id,
      revocation_reason = trim(p_revocation_reason)
  WHERE id = p_restriction_id;

  -- 7. Emit Immutable System Audit Log
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
    v_actor_id,
    v_actor_role_label,
    'CHAT_RESTRICTION_REVOKED',
    'CHAT_USER_RESTRICTION',
    p_restriction_id,
    v_restriction.tournament_id,
    jsonb_build_object(
      'target_user_id', v_restriction.user_id,
      'original_restriction_type', v_restriction.restriction_type,
      'scope', v_restriction.scope,
      'tournament_id', v_restriction.tournament_id,
      'original_reason', v_restriction.reason,
      'restricted_by', v_restriction.restricted_by,
      'restricted_at', v_restriction.restricted_at,
      'revoked_by', v_actor_id,
      'revocation_reason', trim(p_revocation_reason),
      'revoked_at', timezone('utc'::text, now())
    ),
    timezone('utc'::text, now())
  );

  -- 8. Authenticated Read & Return
  SELECT * INTO v_result
  FROM public.chat_user_restrictions
  WHERE id = p_restriction_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_chat_restriction(UUID, TEXT) TO authenticated;
