-- ==============================================================================
-- MIGRATION: 20260826000048_repair_update_club_profile_partial_semantics.sql
-- PURPOSE: Forward-only repair of public.update_club_profile RPC partial-update semantics.
--          Enforces CASE-based NULL-preserving semantics across all 6 mutable fields:
--          - NULL / omitted = preserve existing database value
--          - empty string / whitespace = clear field to NULL
--          - non-empty value = trim and update
-- PHASE: 23B-5
-- ==============================================================================

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
    short_name = CASE 
      WHEN p_short_name IS NOT NULL THEN NULLIF(TRIM(p_short_name), '')
      ELSE short_name 
    END,
    street_address = CASE 
      WHEN p_street_address IS NOT NULL THEN NULLIF(TRIM(p_street_address), '')
      ELSE street_address 
    END,
    city = CASE 
      WHEN p_city IS NOT NULL THEN NULLIF(TRIM(p_city), '')
      ELSE city 
    END,
    province = CASE 
      WHEN p_province IS NOT NULL THEN NULLIF(TRIM(p_province), '')
      ELSE province 
    END,
    postal_code = CASE 
      WHEN p_postal_code IS NOT NULL THEN NULLIF(TRIM(p_postal_code), '')
      ELSE postal_code 
    END,
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
