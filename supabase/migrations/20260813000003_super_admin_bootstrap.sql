-- Phase 1D: Super Admin Bootstrap Migration
-- Creates database-enforced Super Admin bootstrap trigger for approved Google identities.

-- 1. Create handle_super_admin_bootstrap trigger function
CREATE OR REPLACE FUNCTION public.handle_super_admin_bootstrap()
RETURNS TRIGGER AS $$
BEGIN
  -- Verify email presence
  IF NEW.email IS NULL OR TRIM(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  -- Verify email is confirmed
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Verify authoritative identity provider is Google
  IF NOT (
    NEW.raw_app_meta_data->>'provider' = 'google'
    OR NEW.raw_app_meta_data->'providers' @> '["google"]'::jsonb
  ) THEN
    RETURN NEW;
  END IF;

  -- Verify email belongs to authoritative Super Admin allowlist
  IF LOWER(TRIM(NEW.email)) NOT IN (
    'nlusigodo@gmail.com',
    'uaaphil@gmail.com',
    'edwin.broma10@gmail.com'
  ) THEN
    RETURN NEW;
  END IF;

  -- Verify corresponding profile record exists in public.profiles (FK requirement)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Evaluate Conflict Matrix for permanent user roles
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'SUPER_ADMIN') THEN
    -- CASE 2: SUPER_ADMIN already assigned (Idempotent NO-OP)
    RETURN NEW;
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    -- CASE 3: Conflicting permanent role exists (DO NOT overwrite, elevate, or delete)
    RAISE WARNING 'User % (%) is allowlisted for SUPER_ADMIN but already possesses another permanent role. Manual resolution required.', NEW.id, NEW.email;
    RETURN NEW;
  ELSE
    -- CASE 1: Allowlisted + verified Google + no existing permanent role -> Assign SUPER_ADMIN
    INSERT INTO public.user_roles (user_id, role, assigned_by)
    VALUES (NEW.id, 'SUPER_ADMIN'::app_role, NEW.id)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Explicitly revoke execution privileges from non-owner client roles
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM anon;

-- 3. Create Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_super_admin_bootstrap ON auth.users;
CREATE TRIGGER on_auth_user_super_admin_bootstrap
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_super_admin_bootstrap();
