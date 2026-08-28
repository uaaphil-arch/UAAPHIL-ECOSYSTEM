-- Migration: 20260830000056_enable_chat_restrictions_realtime.sql
-- Domain: Supabase Realtime Publication Enablement for Chat Disciplinary Restrictions
--         (Enables instant lock/unlock notification streams across all active client sessions).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_user_restrictions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_user_restrictions;
    END IF;
  END IF;
END $$;
