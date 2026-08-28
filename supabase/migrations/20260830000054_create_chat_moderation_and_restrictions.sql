-- Migration: 20260830000054_create_chat_moderation_and_restrictions.sql
-- Domain: Native Chat Moderation, User Disciplinary Restrictions (BAN, MUTE, TIMEOUT), 
--         Role Hierarchy Hardening, and Server-Authoritative RLS Enforcement.

-- -----------------------------------------------------------------------------
-- 1. HELPER: is_super_admin_or_admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin_or_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = p_user_id 
      AND role IN ('SUPER_ADMIN'::public.app_role, 'ADMIN'::public.app_role)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin_or_admin(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. TABLE: public.chat_user_restrictions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_user_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  restriction_type TEXT NOT NULL CHECK (restriction_type IN ('BAN', 'MUTE', 'TIMEOUT')),
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'TOURNAMENT', 'ALL_CHAT')),
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) > 0 AND char_length(reason) <= 500),
  restricted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  restricted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revocation_reason TEXT,

  -- Constraint A: Scope vs tournament_id invariant
  CONSTRAINT chk_chat_restriction_scope CHECK (
    (scope = 'TOURNAMENT' AND tournament_id IS NOT NULL) OR
    (scope IN ('GLOBAL', 'ALL_CHAT') AND tournament_id IS NULL)
  ),

  -- Constraint B: Expiration rules (TIMEOUT must have expires_at; BAN/MUTE may be indefinite or temporary)
  CONSTRAINT chk_chat_restriction_expiry CHECK (
    (restriction_type = 'TIMEOUT' AND expires_at IS NOT NULL) OR
    (restriction_type IN ('BAN', 'MUTE'))
  ),

  -- Constraint C: Revocation state consistency
  CONSTRAINT chk_chat_restriction_revocation CHECK (
    (is_active = TRUE AND revoked_at IS NULL AND revoked_by IS NULL) OR
    (is_active = FALSE AND revoked_at IS NOT NULL)
  )
);

-- Comments
COMMENT ON TABLE public.chat_user_restrictions IS 'Authoritative disciplinary restrictions (BAN, MUTE, TIMEOUT) applied to chat participants without affecting tournament registration or athlete/coach operations.';
COMMENT ON COLUMN public.chat_user_restrictions.restriction_type IS 'Disciplinary penalty type: BAN (full denial), MUTE (read-only), TIMEOUT (temporary mute).';
COMMENT ON COLUMN public.chat_user_restrictions.scope IS 'Restriction scope: GLOBAL (official global forum), TOURNAMENT (specific tournament), ALL_CHAT (system-wide chat denial).';

-- -----------------------------------------------------------------------------
-- 3. UNIQUE & PERFORMANCE INDEXES
-- -----------------------------------------------------------------------------

-- Prevent duplicate concurrent active restrictions for the same user, scope, and tournament target
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_chat_user_restriction
  ON public.chat_user_restrictions (
    user_id,
    scope,
    COALESCE(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_active = TRUE;

-- Lookup indexes for fast RLS and user status queries
CREATE INDEX IF NOT EXISTS idx_chat_user_restrictions_user_lookup
  ON public.chat_user_restrictions(user_id, is_active, scope);

CREATE INDEX IF NOT EXISTS idx_chat_user_restrictions_tournament_lookup
  ON public.chat_user_restrictions(tournament_id, is_active)
  WHERE tournament_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_user_restrictions_expires_at
  ON public.chat_user_restrictions(expires_at)
  WHERE expires_at IS NOT NULL AND is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 4. FUNCTION: is_user_chat_restricted
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_user_chat_restricted(p_user_id UUID, p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_type TEXT;
  v_tournament_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Resolve target room context
  SELECT room_type, tournament_id
  INTO v_room_type, v_tournament_id
  FROM public.chat_rooms
  WHERE id = p_room_id;

  IF v_room_type IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if user has an active, unexpired restriction that covers this room scope
  RETURN EXISTS (
    SELECT 1
    FROM public.chat_user_restrictions
    WHERE user_id = p_user_id
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > timezone('utc'::text, now()))
      AND (
        scope = 'ALL_CHAT'
        OR (scope = 'GLOBAL' AND v_room_type = 'GLOBAL')
        OR (scope = 'TOURNAMENT' AND v_room_type = 'TOURNAMENT' AND tournament_id = v_tournament_id)
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_user_chat_restricted(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. FUNCTION: can_moderate_chat (Role Boundary Hardening)
-- -----------------------------------------------------------------------------
-- Hardens role boundaries so that ORGANIZER cannot moderate GLOBAL chat or
-- other organizers' tournaments. Only SUPER_ADMIN and ADMIN have system-wide authority.
CREATE OR REPLACE FUNCTION public.can_moderate_chat(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_type TEXT;
  v_tournament_id UUID;
  v_organizer_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.is_active_profile(p_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Super Admins and Admins can moderate all rooms (GLOBAL and all TOURNAMENT rooms)
  IF public.is_super_admin_or_admin(p_user_id) THEN
    RETURN TRUE;
  END IF;

  -- Tournament Organizers can ONLY moderate tournament rooms belonging to their owned tournaments
  SELECT cr.room_type, cr.tournament_id, t.organizer_id
  INTO v_room_type, v_tournament_id, v_organizer_id
  FROM public.chat_rooms cr
  LEFT JOIN public.tournaments t ON t.id = cr.tournament_id
  WHERE cr.id = p_room_id;

  IF v_room_type = 'TOURNAMENT' AND v_tournament_id IS NOT NULL AND v_organizer_id IS NOT NULL AND v_organizer_id = p_user_id THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_moderate_chat(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. FUNCTION: can_send_chat_message (Integrated Restriction Checking)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_send_chat_message(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_archived BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check room archive state
  SELECT is_archived INTO v_is_archived
  FROM public.chat_rooms
  WHERE id = p_room_id;

  -- Messages cannot be sent to non-existent or archived rooms
  IF v_is_archived IS NULL OR v_is_archived = TRUE THEN
    RETURN FALSE;
  END IF;

  -- Check if user is subject to an active disciplinary restriction (BAN / MUTE / TIMEOUT)
  IF public.is_user_chat_restricted(p_user_id, p_room_id) THEN
    RETURN FALSE;
  END IF;

  -- User must satisfy room access permissions
  RETURN public.can_access_chat_room(p_room_id, p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_send_chat_message(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES ON public.chat_user_restrictions
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_user_restrictions ENABLE ROW LEVEL SECURITY;

-- A. SELECT: Users can view their own restrictions; moderators can view applicable restrictions
DROP POLICY IF EXISTS "chat_user_restrictions_select" ON public.chat_user_restrictions;
CREATE POLICY "chat_user_restrictions_select"
  ON public.chat_user_restrictions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin_or_admin(auth.uid())
    OR (
      scope = 'TOURNAMENT' 
      AND tournament_id IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  );

-- B. INSERT: Restricted to Super Admins, Admins, and Tournament Organizers (for their own tournament scope)
DROP POLICY IF EXISTS "chat_user_restrictions_insert" ON public.chat_user_restrictions;
CREATE POLICY "chat_user_restrictions_insert"
  ON public.chat_user_restrictions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    restricted_by = auth.uid() AND (
      public.is_super_admin_or_admin(auth.uid())
      OR (
        scope = 'TOURNAMENT'
        AND tournament_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.tournaments t
          WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
        )
      )
    )
  );

-- C. UPDATE: Restricted to Super Admins, Admins, and Tournament Organizers (for revocation workflows)
DROP POLICY IF EXISTS "chat_user_restrictions_update" ON public.chat_user_restrictions;
CREATE POLICY "chat_user_restrictions_update"
  ON public.chat_user_restrictions
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin_or_admin(auth.uid())
    OR (
      scope = 'TOURNAMENT'
      AND tournament_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_super_admin_or_admin(auth.uid())
    OR (
      scope = 'TOURNAMENT'
      AND tournament_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
      )
    )
  );

-- D. DELETE: Super Admin only
DROP POLICY IF EXISTS "chat_user_restrictions_delete" ON public.chat_user_restrictions;
CREATE POLICY "chat_user_restrictions_delete"
  ON public.chat_user_restrictions
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
