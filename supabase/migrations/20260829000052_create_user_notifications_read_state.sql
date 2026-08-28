-- ============================================================================
-- Migration: 20260829000052_create_user_notifications_read_state.sql
-- Description: NOTIF-FIX-01 Per-User Notification Read State Architecture
--
-- Invariants Enforced:
-- INV-01: system_audit_logs remains immutable, append-only operational ledger
-- INV-02: Per-user notification read/unread lifecycle isolated in dedicated table
-- INV-03: Strict RLS enforcement - Users can only view and update their own read states (auth.uid() = user_id)
-- INV-04: Idempotent mark-as-read RPCs (UNIQUE constraint on user_id, notification_id)
-- INV-05: Server-side validation with zero privileged credential exposure
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.user_notification_reads
-- Stores individual read state records per user for operational notifications.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notification_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  audit_log_id UUID REFERENCES public.system_audit_logs(id) ON DELETE CASCADE,
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_notification_read UNIQUE (user_id, notification_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user_tourn
  ON public.user_notification_reads (user_id, tournament_id);

CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user_notif
  ON public.user_notification_reads (user_id, notification_id);

-- ----------------------------------------------------------------------------
-- 2. Row Level Security (RLS)
-- Enforce strict boundary: Users can ONLY access/mutate their own read records.
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notification read records" ON public.user_notification_reads;
CREATE POLICY "Users can view their own notification read records"
  ON public.user_notification_reads
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notification read records" ON public.user_notification_reads;
CREATE POLICY "Users can insert their own notification read records"
  ON public.user_notification_reads
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification read records" ON public.user_notification_reads;
CREATE POLICY "Users can update their own notification read records"
  ON public.user_notification_reads
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notification read records" ON public.user_notification_reads;
CREATE POLICY "Users can delete their own notification read records"
  ON public.user_notification_reads
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. RPC: public.mark_notification_read
-- Marks a single notification as read for the authenticated caller. Idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id TEXT,
  p_audit_log_id UUID DEFAULT NULL,
  p_tournament_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_inserted_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to mark notification as read.'
      USING ERRCODE = '40100';
  END IF;

  IF p_notification_id IS NULL OR TRIM(p_notification_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_notification_id cannot be null or empty.'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.user_notification_reads (
    user_id,
    notification_id,
    audit_log_id,
    tournament_id,
    read_at,
    created_at
  )
  VALUES (
    v_user_id,
    p_notification_id,
    p_audit_log_id,
    p_tournament_id,
    v_now,
    v_now
  )
  ON CONFLICT (user_id, notification_id)
  DO UPDATE SET
    read_at = EXCLUDED.read_at
  RETURNING id INTO v_inserted_id;

  RETURN jsonb_build_object(
    'success', true,
    'notification_id', p_notification_id,
    'record_id', v_inserted_id,
    'read_at', v_now
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: public.mark_all_notifications_read
-- Marks an array of notifications as read for the authenticated caller. Idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_notification_ids TEXT[],
  p_tournament_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_notif_id TEXT;
  v_processed_count INT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to mark notifications as read.'
      USING ERRCODE = '40100';
  END IF;

  IF p_notification_ids IS NULL OR array_length(p_notification_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed_count', 0,
      'read_at', v_now
    );
  END IF;

  FOREACH v_notif_id IN ARRAY p_notification_ids
  LOOP
    IF v_notif_id IS NOT NULL AND TRIM(v_notif_id) <> '' THEN
      INSERT INTO public.user_notification_reads (
        user_id,
        notification_id,
        tournament_id,
        read_at,
        created_at
      )
      VALUES (
        v_user_id,
        v_notif_id,
        p_tournament_id,
        v_now,
        v_now
      )
      ON CONFLICT (user_id, notification_id)
      DO UPDATE SET
        read_at = EXCLUDED.read_at;

      v_processed_count := v_processed_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed_count', v_processed_count,
    'read_at', v_now
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: public.get_user_read_notification_ids
-- Retrieves the set of read notification IDs for the authenticated caller.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_read_notification_ids(
  p_tournament_id UUID DEFAULT NULL
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_result TEXT[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT COALESCE(array_agg(notification_id), ARRAY[]::TEXT[])
  INTO v_result
  FROM public.user_notification_reads
  WHERE user_id = v_user_id
    AND (p_tournament_id IS NULL OR tournament_id = p_tournament_id OR tournament_id IS NULL);

  RETURN v_result;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.mark_notification_read(TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(TEXT[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_read_notification_ids(UUID) TO authenticated;
