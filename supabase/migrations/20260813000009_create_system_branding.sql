-- Phase 1K Migration: Create System Branding Management
-- Migration: 20260813000009_create_system_branding.sql
--
-- PURPOSE:
-- 1. Create `public.system_branding` table for centralized tournament and system brand configuration.
-- 2. Create `public.app_settings` key-value table and compatibility sync for app-wide settings.
-- 3. Implement `public.get_active_branding()` RPC accessible to public/anon for immediate public layout hydration.
-- 4. Implement `public.update_system_branding(...)` RPC with strict Super Admin authorization, active requester check, audit logging, and payload validation.
-- 5. Create storage bucket `branding` (if storage schema exists) with public read access and Super Admin/Admin write policies.
-- 6. Preserve existing migrations 000001 through 000008, all existing domain tables, and RLS policies.
--
-- SECURITY & AUTHORIZATION INVARIANTS:
-- 1. SECURITY DEFINER with `search_path TO 'public', 'pg_temp'`.
-- 2. Requester authentication and active `SUPER_ADMIN` status strictly verified via `auth.uid()`.
-- 3. Requester profile must possess `status = 'ACTIVE'` (using verified `public.profiles.status` column).
-- 4. Audit logging strictly integrated into `public.system_audit_logs`.
-- 5. Execution of `get_active_branding` granted to PUBLIC, anon, and authenticated.
-- 6. Execution of `update_system_branding` revoked from PUBLIC and anon; granted strictly to authenticated.

-- 1. Create system_branding Table
CREATE TABLE IF NOT EXISTS public.system_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name TEXT NOT NULL DEFAULT 'UAAPHIL',
  short_name TEXT NOT NULL DEFAULT 'UAAPHIL',
  logo_url TEXT NOT NULL DEFAULT '/logo.webp',
  favicon_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1e3a8a',
  secondary_color TEXT NOT NULL DEFAULT '#dc2626',
  accent_color TEXT NOT NULL DEFAULT '#f59e0b',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS system_branding_is_active_idx ON public.system_branding(is_active);
CREATE INDEX IF NOT EXISTS system_branding_updated_at_idx ON public.system_branding(updated_at DESC);

-- 2. Create app_settings Table (Compatibility & Extended Key-Value Config)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 3. Enable RLS
ALTER TABLE public.system_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for system_branding
-- Anyone can view active branding (needed for login page, public scoreboard, and navbar)
DROP POLICY IF EXISTS "Public can view active branding" ON public.system_branding;
CREATE POLICY "Public can view active branding"
  ON public.system_branding
  FOR SELECT
  TO public
  USING (is_active = TRUE);

-- Super Admins and Admins can view all branding records
DROP POLICY IF EXISTS "Admins can view all branding" ON public.system_branding;
CREATE POLICY "Admins can view all branding"
  ON public.system_branding
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
    )
  );

-- Only Super Admins can insert/update/delete branding rows directly
DROP POLICY IF EXISTS "Super Admins can manage branding" ON public.system_branding;
CREATE POLICY "Super Admins can manage branding"
  ON public.system_branding
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'SUPER_ADMIN'
    )
  );

-- 5. RLS Policies for app_settings
DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
CREATE POLICY "app_settings_select_all"
  ON public.app_settings
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "app_settings_manage_admin" ON public.app_settings;
CREATE POLICY "app_settings_manage_admin"
  ON public.app_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
    )
  );

-- 6. Seed Initial Default Branding (Idempotent)
INSERT INTO public.system_branding (
  organization_name,
  short_name,
  logo_url,
  favicon_url,
  primary_color,
  secondary_color,
  accent_color,
  is_active
)
SELECT 
  'UAAPHIL Tournament System',
  'UAAPHIL',
  '/logo.webp',
  '/logo.webp',
  '#1e3a8a',
  '#dc2626',
  '#f59e0b',
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.system_branding);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'branding',
  jsonb_build_object(
    'logo_url', '/logo.webp',
    'app_title', 'UAAPHIL Tournament System',
    'updated_at', timezone('utc'::text, now())
  ),
  timezone('utc'::text, now())
)
ON CONFLICT (key) DO NOTHING;

-- 7. RPC: get_active_branding (Publicly accessible)
CREATE OR REPLACE FUNCTION public.get_active_branding()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branding JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', id,
    'organization_name', organization_name,
    'short_name', short_name,
    'logo_url', logo_url,
    'favicon_url', favicon_url,
    'primary_color', primary_color,
    'secondary_color', secondary_color,
    'accent_color', accent_color,
    'is_active', is_active,
    'updated_by', updated_by,
    'updated_at', updated_at
  )
  INTO v_branding
  FROM public.system_branding
  WHERE is_active = TRUE
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_branding IS NULL THEN
    -- Fallback default object
    v_branding := jsonb_build_object(
      'organization_name', 'UAAPHIL Tournament System',
      'short_name', 'UAAPHIL',
      'logo_url', '/logo.webp',
      'favicon_url', '/logo.webp',
      'primary_color', '#1e3a8a',
      'secondary_color', '#dc2626',
      'accent_color', '#f59e0b',
      'is_active', TRUE
    );
  END IF;

  RETURN v_branding;
END;
$$;

-- 8. RPC: update_system_branding (Super Admin only, with audit logging)
CREATE OR REPLACE FUNCTION public.update_system_branding(
  p_organization_name TEXT,
  p_short_name TEXT,
  p_logo_url TEXT,
  p_favicon_url TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT '#1e3a8a',
  p_secondary_color TEXT DEFAULT '#dc2626',
  p_accent_color TEXT DEFAULT '#f59e0b'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_requester_is_super_admin BOOLEAN;
  v_requester_status TEXT;
  v_branding_id UUID;
  v_result JSONB;
  v_clean_logo_url TEXT;
  v_clean_org_name TEXT;
  v_clean_short_name TEXT;
BEGIN
  -- 1. Identify Requester Session
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  -- 2. Validate Super Admin Authority & Active Status
  SELECT 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_requester_id AND role = 'SUPER_ADMIN'),
    p.status
  INTO v_requester_is_super_admin, v_requester_status
  FROM public.profiles p
  WHERE p.id = v_requester_id;

  IF NOT COALESCE(v_requester_is_super_admin, FALSE) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only SUPER_ADMIN can update system branding'
      USING ERRCODE = '40300';
  END IF;

  IF v_requester_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FORBIDDEN: Requester account is not active'
      USING ERRCODE = '40300';
  END IF;

  -- 3. Sanitize and Validate Inputs
  v_clean_org_name := TRIM(COALESCE(p_organization_name, 'UAAPHIL Tournament System'));
  v_clean_short_name := TRIM(COALESCE(p_short_name, 'UAAPHIL'));
  v_clean_logo_url := TRIM(COALESCE(p_logo_url, '/logo.webp'));

  IF v_clean_logo_url = '' THEN
    v_clean_logo_url := '/logo.webp';
  END IF;

  -- 4. Upsert Active System Branding Record
  SELECT id INTO v_branding_id
  FROM public.system_branding
  WHERE is_active = TRUE
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_branding_id IS NOT NULL THEN
    UPDATE public.system_branding
    SET 
      organization_name = v_clean_org_name,
      short_name = v_clean_short_name,
      logo_url = v_clean_logo_url,
      favicon_url = COALESCE(NULLIF(TRIM(p_favicon_url), ''), v_clean_logo_url),
      primary_color = COALESCE(NULLIF(TRIM(p_primary_color), ''), '#1e3a8a'),
      secondary_color = COALESCE(NULLIF(TRIM(p_secondary_color), ''), '#dc2626'),
      accent_color = COALESCE(NULLIF(TRIM(p_accent_color), ''), '#f59e0b'),
      updated_by = v_requester_id,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_branding_id
    RETURNING id INTO v_branding_id;
  ELSE
    INSERT INTO public.system_branding (
      organization_name,
      short_name,
      logo_url,
      favicon_url,
      primary_color,
      secondary_color,
      accent_color,
      is_active,
      updated_by,
      updated_at
    ) VALUES (
      v_clean_org_name,
      v_clean_short_name,
      v_clean_logo_url,
      COALESCE(NULLIF(TRIM(p_favicon_url), ''), v_clean_logo_url),
      COALESCE(NULLIF(TRIM(p_primary_color), ''), '#1e3a8a'),
      COALESCE(NULLIF(TRIM(p_secondary_color), ''), '#dc2626'),
      COALESCE(NULLIF(TRIM(p_accent_color), ''), '#f59e0b'),
      TRUE,
      v_requester_id,
      timezone('utc'::text, now())
    )
    RETURNING id INTO v_branding_id;
  END IF;

  -- 5. Sync to app_settings key-value store for backwards compatibility
  INSERT INTO public.app_settings (key, value, updated_at, updated_by)
  VALUES (
    'branding',
    jsonb_build_object(
      'logo_url', v_clean_logo_url,
      'app_title', v_clean_org_name,
      'updated_at', timezone('utc'::text, now()),
      'updated_by', v_requester_id
    ),
    timezone('utc'::text, now()),
    v_requester_id
  )
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by;

  -- 6. Insert Governance Audit Log
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
    'UPDATE_SYSTEM_BRANDING',
    'SYSTEM_BRANDING',
    v_branding_id,
    jsonb_build_object(
      'organization_name', v_clean_org_name,
      'short_name', v_clean_short_name,
      'logo_url', v_clean_logo_url,
      'updated_at', timezone('utc'::text, now())
    ),
    timezone('utc'::text, now())
  );

  -- 7. Build Response Object
  v_result := jsonb_build_object(
    'success', TRUE,
    'id', v_branding_id,
    'organization_name', v_clean_org_name,
    'short_name', v_clean_short_name,
    'logo_url', v_clean_logo_url,
    'updated_at', timezone('utc'::text, now()),
    'updated_by', v_requester_id
  );

  RETURN v_result;
END;
$$;

-- 9. Storage Setup for 'branding' Bucket (Safe Block)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'branding',
      'branding',
      true,
      2097152, -- 2MB limit
      ARRAY['image/png', 'image/webp', 'image/svg+xml', 'image/jpeg']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = true,
      file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/png', 'image/webp', 'image/svg+xml', 'image/jpeg'];

    -- Storage RLS: Public read for branding assets
    DROP POLICY IF EXISTS "branding_storage_public_read" ON storage.objects;
    CREATE POLICY "branding_storage_public_read"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'branding');

    -- Storage RLS: Admin insert for branding assets
    DROP POLICY IF EXISTS "branding_storage_admin_insert" ON storage.objects;
    CREATE POLICY "branding_storage_admin_insert"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'branding' AND
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
          AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
        )
      );

    -- Storage RLS: Admin update for branding assets
    DROP POLICY IF EXISTS "branding_storage_admin_update" ON storage.objects;
    CREATE POLICY "branding_storage_admin_update"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'branding' AND
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
          AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
        )
      );

    -- Storage RLS: Admin delete for branding assets
    DROP POLICY IF EXISTS "branding_storage_admin_delete" ON storage.objects;
    CREATE POLICY "branding_storage_admin_delete"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'branding' AND
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
          AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
        )
      );
  END IF;
END $$;

-- 10. Explicit Function Execution Grants
-- get_active_branding is public for immediate UI hydration
REVOKE ALL ON FUNCTION public.get_active_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_branding() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_branding() TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_branding() TO authenticated;

-- update_system_branding is strictly authenticated (authorizes Super Admin internally)
REVOKE ALL ON FUNCTION public.update_system_branding(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_system_branding(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
