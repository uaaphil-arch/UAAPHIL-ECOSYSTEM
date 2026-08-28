-- =============================================================================
-- Migration: 20260830000053_create_native_chat_system.sql
-- Description: Phase 11-D: Native Supabase Realtime Chat Database Foundation,
--              Scoped Access Control, Retention Metadata & Security Policies.
-- Authoritative Contracts:
--   1. public.profiles (id, status = 'ACTIVE')
--   2. public.app_role ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH')
--   3. public.user_roles (user_id, role)
--   4. public.tournaments (id, organizer_id, status)
--   5. public.is_super_admin(UUID) & public.is_admin_or_higher(UUID)
--   6. public.is_authorized_tournament_official(UUID, UUID, UUID, UUID, BOOLEAN)
--   7. public.club_coaches (club_id, coach_user_id, status = 'ACTIVE')
--   8. public.registrations (event_id, club_id)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLE: public.chat_rooms
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type TEXT NOT NULL CHECK (room_type IN ('GLOBAL', 'TOURNAMENT')),
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 150),
  description TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (0, 30, 60, 90)),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_chat_room_tournament_scope CHECK (
    (room_type = 'TOURNAMENT' AND tournament_id IS NOT NULL) OR
    (room_type = 'GLOBAL' AND tournament_id IS NULL)
  ),
  CONSTRAINT uq_single_active_tournament_chat UNIQUE (tournament_id, room_type)
);

-- Unique index to guarantee exactly one GLOBAL chat room
CREATE UNIQUE INDEX IF NOT EXISTS uq_global_chat_room 
  ON public.chat_rooms(room_type) 
  WHERE room_type = 'GLOBAL';

CREATE INDEX IF NOT EXISTS idx_chat_rooms_tournament_id 
  ON public.chat_rooms(tournament_id) 
  WHERE tournament_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_rooms_room_type 
  ON public.chat_rooms(room_type);

-- -----------------------------------------------------------------------------
-- 2. TABLE: public.chat_messages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (char_length(trim(content)) > 0 AND char_length(content) <= 2000),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_chat_message_deletion CHECK (
    (is_deleted = FALSE AND deleted_at IS NULL AND deleted_by IS NULL) OR
    (is_deleted = TRUE AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT uq_chat_messages_room_message UNIQUE (room_id, id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created 
  ON public.chat_messages(room_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_retention_purge 
  ON public.chat_messages(created_at) 
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id 
  ON public.chat_messages(sender_id);

-- -----------------------------------------------------------------------------
-- 3. TABLE: public.chat_read_states
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_read_states (
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_message_id UUID,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_chat_read_states_room_message FOREIGN KEY (room_id, last_read_message_id)
    REFERENCES public.chat_messages(room_id, id) ON DELETE SET NULL (last_read_message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_states_user_id 
  ON public.chat_read_states(user_id);

-- -----------------------------------------------------------------------------
-- 4. TRIGGERS: updated_at Maintenance
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_chat_rooms_updated_at ON public.chat_rooms;
CREATE TRIGGER trg_chat_rooms_updated_at
  BEFORE UPDATE ON public.chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_chat_messages_updated_at ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 5. HARDENED SECURITY & AUTHORIZATION HELPERS
-- -----------------------------------------------------------------------------

-- Helper 1: Verify user possesses an active profile
CREATE OR REPLACE FUNCTION public.is_active_profile(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = p_user_id AND status = 'ACTIVE'
  );
$$;

-- Helper 2: Verify user room read & discovery authorization
CREATE OR REPLACE FUNCTION public.can_access_chat_room(p_room_id UUID, p_user_id UUID)
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

  -- 1. Profile must be active
  IF NOT public.is_active_profile(p_user_id) THEN
    RETURN FALSE;
  END IF;

  -- 2. Fetch room type and associated tournament
  SELECT cr.room_type, cr.tournament_id, t.organizer_id
  INTO v_room_type, v_tournament_id, v_organizer_id
  FROM public.chat_rooms cr
  LEFT JOIN public.tournaments t ON t.id = cr.tournament_id
  WHERE cr.id = p_room_id;

  IF v_room_type IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 3. GLOBAL Chat is readable by all active authenticated users
  IF v_room_type = 'GLOBAL' THEN
    RETURN TRUE;
  END IF;

  -- 4. TOURNAMENT Chat Access
  IF v_room_type = 'TOURNAMENT' AND v_tournament_id IS NOT NULL THEN
    -- A. Super Admins & Admins have full access
    IF public.is_admin_or_higher(p_user_id) THEN
      RETURN TRUE;
    END IF;

    -- B. Tournament Organizer owns the tournament
    IF v_organizer_id IS NOT NULL AND v_organizer_id = p_user_id THEN
      RETURN TRUE;
    END IF;

    -- C. Assigned Tournament / Court Officials
    IF public.is_authorized_tournament_official(p_user_id, v_tournament_id, NULL, NULL, TRUE) THEN
      RETURN TRUE;
    END IF;

    -- D. Registered & Participating Coaches (via active club coach assignment and tournament registrations)
    IF EXISTS (
      SELECT 1
      FROM public.registrations r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.tournament_snapshots ts ON ts.id = e.snapshot_id
      JOIN public.club_coaches cc ON cc.club_id = r.club_id
      WHERE ts.tournament_id = v_tournament_id
        AND cc.coach_user_id = p_user_id
        AND cc.status = 'ACTIVE'
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- Helper 3: Verify user permission to send a message
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

  -- User must satisfy room access permissions
  RETURN public.can_access_chat_room(p_room_id, p_user_id);
END;
$$;

-- Helper 4: Verify user moderation authority
CREATE OR REPLACE FUNCTION public.can_moderate_chat(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_type TEXT;
  v_organizer_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.is_active_profile(p_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Super Admins and Admins can moderate all rooms
  IF public.is_admin_or_higher(p_user_id) THEN
    RETURN TRUE;
  END IF;

  -- Tournament Organizers can moderate their own tournament room
  SELECT cr.room_type, t.organizer_id
  INTO v_room_type, v_organizer_id
  FROM public.chat_rooms cr
  JOIN public.tournaments t ON t.id = cr.tournament_id
  WHERE cr.id = p_room_id;

  IF v_room_type = 'TOURNAMENT' AND v_organizer_id IS NOT NULL AND v_organizer_id = p_user_id THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_read_states ENABLE ROW LEVEL SECURITY;

-- A. Policies for public.chat_rooms
DROP POLICY IF EXISTS "chat_rooms_select" ON public.chat_rooms;
CREATE POLICY "chat_rooms_select"
  ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (public.can_access_chat_room(id, auth.uid()));

DROP POLICY IF EXISTS "chat_rooms_insert" ON public.chat_rooms;
CREATE POLICY "chat_rooms_insert"
  ON public.chat_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND (
      public.is_admin_or_higher(auth.uid()) OR (
        room_type = 'TOURNAMENT' AND EXISTS (
          SELECT 1 FROM public.tournaments t
          WHERE t.id = tournament_id AND t.organizer_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "chat_rooms_update" ON public.chat_rooms;
CREATE POLICY "chat_rooms_update"
  ON public.chat_rooms
  FOR UPDATE
  TO authenticated
  USING (public.can_moderate_chat(id, auth.uid()))
  WITH CHECK (public.can_moderate_chat(id, auth.uid()));

DROP POLICY IF EXISTS "chat_rooms_delete" ON public.chat_rooms;
CREATE POLICY "chat_rooms_delete"
  ON public.chat_rooms
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- B. Policies for public.chat_messages
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
CREATE POLICY "chat_messages_select"
  ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (public.can_access_chat_room(room_id, auth.uid()));

DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_insert"
  ON public.chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid() 
    AND public.can_send_chat_message(room_id, auth.uid()) 
    AND is_deleted = FALSE
  );

DROP POLICY IF EXISTS "chat_messages_update" ON public.chat_messages;
CREATE POLICY "chat_messages_update"
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    public.can_moderate_chat(room_id, auth.uid()) 
    OR (sender_id = auth.uid() AND is_deleted = FALSE)
  )
  WITH CHECK (
    public.can_moderate_chat(room_id, auth.uid()) 
    OR (
      sender_id = auth.uid() 
      AND is_deleted = FALSE 
      AND deleted_at IS NULL 
      AND deleted_by IS NULL 
      AND deleted_reason IS NULL
    )
  );

DROP POLICY IF EXISTS "chat_messages_delete" ON public.chat_messages;
CREATE POLICY "chat_messages_delete"
  ON public.chat_messages
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- C. Policies for public.chat_read_states
DROP POLICY IF EXISTS "chat_read_states_select" ON public.chat_read_states;
CREATE POLICY "chat_read_states_select"
  ON public.chat_read_states
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND public.can_access_chat_room(room_id, auth.uid()));

DROP POLICY IF EXISTS "chat_read_states_insert" ON public.chat_read_states;
CREATE POLICY "chat_read_states_insert"
  ON public.chat_read_states
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_chat_room(room_id, auth.uid()));

DROP POLICY IF EXISTS "chat_read_states_update" ON public.chat_read_states;
CREATE POLICY "chat_read_states_update"
  ON public.chat_read_states
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "chat_read_states_delete" ON public.chat_read_states;
CREATE POLICY "chat_read_states_delete"
  ON public.chat_read_states
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 7. SUPABASE REALTIME PUBLICATION PREPARATION
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END $$;
