-- =============================================================================
-- Migration: 20260819000030_reconcile_auth_profile_triggers.sql
-- Description: Reconciles auth.users and public.profiles trigger functions
--              (handle_new_user_profile, check_profile_update_integrity)
--              with authoritative column 'status' and hardened search_path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reconcile public.handle_new_user_profile
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- Verify authoritative email presence
  IF NEW.email IS NULL OR TRIM(NEW.email) = '' THEN
    RAISE EXCEPTION 'Cannot create profile for user without an authoritative email address.';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
    'ACTIVE',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

-- -----------------------------------------------------------------------------
-- 2. Reconcile public.check_profile_update_integrity
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_profile_update_integrity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Modification of profile ID is prohibited.';
  END IF;
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'Modification of profile email is prohibited.';
  END IF;
  IF NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Modification of account status requires administrative authority.';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;
