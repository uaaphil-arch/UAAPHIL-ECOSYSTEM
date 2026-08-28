-- =============================================================================
-- Migration: 20260819000031_reconcile_edwin_super_admin_bootstrap.sql
-- Description: Reconciles Super Admin bootstrap trigger to handle both INSERT
--              and UPDATE events on auth.users, and reconciles existing allowlisted
--              Google identities with active profiles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Upgrade handle_super_admin_bootstrap with hardened search_path
-- -----------------------------------------------------------------------------
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
    VALUES (NEW.id, 'SUPER_ADMIN'::public.app_role, NEW.id)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

-- -----------------------------------------------------------------------------
-- 2. Explicitly revoke execution privileges from non-owner client roles
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_super_admin_bootstrap() FROM anon;

-- -----------------------------------------------------------------------------
-- 3. Upgrade Trigger on auth.users to fire on INSERT and relevant UPDATEs
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_super_admin_bootstrap ON auth.users;
CREATE TRIGGER on_auth_user_super_admin_bootstrap
  AFTER INSERT OR UPDATE OF email_confirmed_at, raw_app_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_super_admin_bootstrap();

-- -----------------------------------------------------------------------------
-- 4. Idempotent Reconciliation for Existing Allowlisted Google Identities
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_user RECORD;
  v_has_super_admin BOOLEAN;
  v_has_other_role BOOLEAN;
BEGIN
  FOR v_user IN
    SELECT 
      u.id,
      LOWER(TRIM(u.email)) AS normalized_email
    FROM auth.users u
    INNER JOIN public.profiles p ON p.id = u.id
    WHERE u.email IS NOT NULL
      AND TRIM(u.email) <> ''
      AND u.email_confirmed_at IS NOT NULL
      AND (
        u.raw_app_meta_data->>'provider' = 'google'
        OR u.raw_app_meta_data->'providers' @> '["google"]'::jsonb
      )
      AND LOWER(TRIM(u.email)) IN (
        'nlusigodo@gmail.com',
        'uaaphil@gmail.com',
        'edwin.broma10@gmail.com'
      )
  LOOP
    -- Check if user already possesses SUPER_ADMIN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = v_user.id AND role = 'SUPER_ADMIN'
    ) INTO v_has_super_admin;

    -- Check if user possesses any other permanent role
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = v_user.id AND role <> 'SUPER_ADMIN'
    ) INTO v_has_other_role;

    IF v_has_super_admin THEN
      -- Case 1: Already SUPER_ADMIN -> Idempotent NO-OP
      RAISE NOTICE 'Reconciliation: User % (%) already possesses SUPER_ADMIN. No action required.', v_user.id, v_user.normalized_email;
    ELSIF v_has_other_role THEN
      -- Case 2: Conflicting permanent role exists -> Preserve untouched
      RAISE WARNING 'Reconciliation Conflict: User % (%) is allowlisted for SUPER_ADMIN but already possesses another permanent role. Existing role preserved.', v_user.id, v_user.normalized_email;
    ELSE
      -- Case 3: Profile exists, verified Google identity, no permanent role -> Assign SUPER_ADMIN
      INSERT INTO public.user_roles (user_id, role, assigned_by, created_at)
      VALUES (v_user.id, 'SUPER_ADMIN'::public.app_role, v_user.id, NOW())
      ON CONFLICT (user_id, role) DO NOTHING;

      RAISE NOTICE 'Reconciliation Success: Assigned SUPER_ADMIN to user % (%).', v_user.id, v_user.normalized_email;
    END IF;
  END LOOP;
END $$;
