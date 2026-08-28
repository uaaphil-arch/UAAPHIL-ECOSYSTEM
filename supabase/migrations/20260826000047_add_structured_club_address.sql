-- ==============================================================================
-- MIGRATION: 20260826000047_add_structured_club_address.sql
-- PURPOSE: Forward-only additive addition of structured address fields to public.clubs
--          and canonical administrative club profile update RPC.
-- PHASE: 23B-2
-- ==============================================================================

-- 1. Add structured address columns to public.clubs (Idempotent & Nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'street_address'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN street_address TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'city'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN city TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'province'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN province TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'postal_code'
  ) THEN
    ALTER TABLE public.clubs ADD COLUMN postal_code TEXT;
  END IF;
END $$;

-- 2. Drop prior 3-argument create_club signature to ensure unambiguous resolution with default parameters
DROP FUNCTION IF EXISTS public.create_club(TEXT, TEXT, TEXT);

-- 3. Canonical create_club RPC supporting optional address fields with full backward compatibility
CREATE OR REPLACE FUNCTION public.create_club(
  p_name TEXT,
  p_code TEXT DEFAULT NULL,
  p_short_name TEXT DEFAULT NULL,
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_province TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_authorized BOOLEAN;
  v_new_club_id UUID;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Administrative authority required'
      USING ERRCODE = '40300';
  END IF;

  IF TRIM(p_name) = '' OR p_name IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Club name is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clubs (
    name, 
    code, 
    short_name,
    street_address,
    city,
    province,
    postal_code
  )
  VALUES (
    TRIM(p_name), 
    NULLIF(TRIM(p_code), ''), 
    NULLIF(TRIM(p_short_name), ''),
    NULLIF(TRIM(p_street_address), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_province), ''),
    NULLIF(TRIM(p_postal_code), '')
  )
  RETURNING id INTO v_new_club_id;

  RETURN jsonb_build_object(
    'success', true,
    'club_id', v_new_club_id,
    'name', p_name,
    'code', p_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Canonical update_club_profile RPC for Admin / Super Admin
CREATE OR REPLACE FUNCTION public.update_club_profile(
  p_club_id UUID,
  p_short_name TEXT DEFAULT NULL,
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_province TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_id UUID;
  v_is_authorized BOOLEAN;
  v_updated_club RECORD;
BEGIN
  v_requester_id := auth.uid();
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required'
      USING ERRCODE = '40100';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_requester_id AND role IN ('SUPER_ADMIN', 'ADMIN')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'FORBIDDEN: Administrative authority required to update club profile'
      USING ERRCODE = '40300';
  END IF;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Club ID is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.clubs
  SET
    short_name = COALESCE(NULLIF(TRIM(p_short_name), ''), short_name),
    street_address = NULLIF(TRIM(p_street_address), ''),
    city = NULLIF(TRIM(p_city), ''),
    province = NULLIF(TRIM(p_province), ''),
    postal_code = NULLIF(TRIM(p_postal_code), ''),
    logo_url = CASE 
      WHEN p_logo_url IS NOT NULL THEN NULLIF(TRIM(p_logo_url), '')
      ELSE logo_url 
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_club_id
  RETURNING * INTO v_updated_club;

  IF v_updated_club.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Club with id % not found', p_club_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'club_id', v_updated_club.id,
    'name', v_updated_club.name,
    'code', v_updated_club.code,
    'short_name', v_updated_club.short_name,
    'street_address', v_updated_club.street_address,
    'city', v_updated_club.city,
    'province', v_updated_club.province,
    'postal_code', v_updated_club.postal_code,
    'logo_url', v_updated_club.logo_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_club_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
