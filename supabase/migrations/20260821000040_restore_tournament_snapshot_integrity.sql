-- ============================================================================
-- RECONCILIATION MIGRATION: 20260821000040_restore_tournament_snapshot_integrity.sql
-- Description: Surgical Restoration of Missing Tournament Snapshots and Foreign Key Integrity.
-- Invariants:
--   1. Restores exact authoritative tournament_snapshots rows for:
--      - Arnis Invitation 2026 (id: '0cf4adc8-96e7-408d-a99c-5788bf0fb310', tournament_id: 'd2743f34-104e-4edb-ae32-c85fe704ba03')
--      - UAAPHIL INVITATIONAL TOUR (id: 'af07517a-bde2-43df-bb3e-a113a83380d5', tournament_id: 'c5598f26-3390-4635-b6f5-5bcaeb70b71a')
--   2. Preserves exact existing snapshot UUIDs, event UUIDs, and tournament bindings.
--   3. Adds foreign key constraint on public.events(snapshot_id) REFERENCES public.tournament_snapshots(id)
--      to prevent future orphan events at the database engine level.
-- ============================================================================

DO $$
BEGIN
  -- 1. Restore Snapshot for Arnis Invitation 2026 if not already present
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_snapshots 
    WHERE id = '0cf4adc8-96e7-408d-a99c-5788bf0fb310'::UUID
  ) THEN
    INSERT INTO public.tournament_snapshots (
      id,
      tournament_id,
      configuration,
      version,
      is_active,
      created_at
    ) VALUES (
      '0cf4adc8-96e7-408d-a99c-5788bf0fb310'::UUID,
      'd2743f34-104e-4edb-ae32-c85fe704ba03'::UUID,
      jsonb_build_object(
        'rulebook_version', 'UAAPHIL 2026.1 Canonical',
        'weigh_in_tolerance_enabled', true,
        'system_architecture', 'SNAPSHOT_FIRST_CANONICAL',
        'schema_version', '1.0',
        'initialized_at', '2026-08-21T10:03:56.576Z'
      ),
      1,
      TRUE,
      '2026-08-21T10:03:56.576Z'::timestamptz
    );
  END IF;

  -- 2. Restore Snapshot for UAAPHIL INVITATIONAL TOUR if not already present
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_snapshots 
    WHERE id = 'af07517a-bde2-43df-bb3e-a113a83380d5'::UUID
  ) THEN
    INSERT INTO public.tournament_snapshots (
      id,
      tournament_id,
      configuration,
      version,
      is_active,
      created_at
    ) VALUES (
      'af07517a-bde2-43df-bb3e-a113a83380d5'::UUID,
      'c5598f26-3390-4635-b6f5-5bcaeb70b71a'::UUID,
      jsonb_build_object(
        'rulebook_version', 'UAAPHIL 2026.1 Canonical',
        'weigh_in_tolerance_enabled', true,
        'system_architecture', 'SNAPSHOT_FIRST_CANONICAL',
        'schema_version', '1.0',
        'initialized_at', '2026-08-21T06:12:13.965Z'
      ),
      1,
      TRUE,
      '2026-08-21T06:12:13.965Z'::timestamptz
    );
  END IF;

  -- 3. Add Foreign Key on public.events(snapshot_id) referencing public.tournament_snapshots(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_events_snapshot_id' 
      AND table_schema = 'public' 
      AND table_name = 'events'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT fk_events_snapshot_id
      FOREIGN KEY (snapshot_id)
      REFERENCES public.tournament_snapshots(id)
      ON DELETE RESTRICT;
  END IF;

  -- 4. Audit Log Entry for Snapshot Restoration
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
    '3c2ae8e1-55c6-40f3-b11d-d9d513776f9b'::UUID,
    'SUPER_ADMIN',
    'RESTORE_TOURNAMENT_SNAPSHOT_INTEGRITY',
    'tournament_snapshots',
    '0cf4adc8-96e7-408d-a99c-5788bf0fb310'::UUID,
    'd2743f34-104e-4edb-ae32-c85fe704ba03'::UUID,
    jsonb_build_object(
      'action', 'SURGICAL_INTEGRITY_RECOVERY',
      'restored_snapshots', jsonb_build_array(
        '0cf4adc8-96e7-408d-a99c-5788bf0fb310',
        'af07517a-bde2-43df-bb3e-a113a83380d5'
      ),
      'foreign_key_added', 'fk_events_snapshot_id'
    ),
    timezone('utc'::text, now())
  );
END $$;
