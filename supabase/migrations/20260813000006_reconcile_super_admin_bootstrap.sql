-- Phase 1E Corrective Migration: Reconcile Super Admin Bootstrap for Existing Allowlisted Google Identities
-- Migration: 20260813000006_reconcile_super_admin_bootstrap.sql
--
-- RATIONALE & AUDIT NOTE:
-- The original Phase 1D migration (20260813000003_super_admin_bootstrap.sql) deployed an
-- `AFTER INSERT ON auth.users` trigger (`handle_super_admin_bootstrap`). While that trigger
-- guarantees bootstrap for newly created accounts, pre-existing allowlisted Google identities
-- that were created in auth.users prior to trigger deployment were not retroactively bootstrapped.
--
-- This one-time, idempotent reconciliation migration scans auth.users for existing authoritative,
-- email-confirmed Google accounts belonging strictly to the three intentional Super Admin allowlist
-- addresses ('nlusigodo@gmail.com', 'uaaphil@gmail.com', 'edwin.broma10@gmail.com').
--
-- CONFLICT MATRIX & PRESERVATION RULES:
-- 1. If allowlisted user already has SUPER_ADMIN: NO-OP.
-- 2. If allowlisted user has a different permanent role: PRESERVED (NO overwrite, NO elevation, NO deletion).
-- 3. If allowlisted user has a profile and NO permanent roles: ASSIGN SUPER_ADMIN (assigned_by = user.id).
-- 4. If allowlisted user does not exist: NO-OP.
-- 5. No client-callable RPCs or elevated permissions are exposed.

DO $$
DECLARE
  v_user RECORD;
  v_has_super_admin BOOLEAN;
  v_has_other_role BOOLEAN;
BEGIN
  -- Loop through allowlisted Google identities in auth.users that have a corresponding profile
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
      -- Case 2: Conflicting permanent role exists -> Preserve untouched, do not overwrite/elevate
      RAISE WARNING 'Reconciliation Conflict: User % (%) is allowlisted for SUPER_ADMIN but already possesses another permanent role. Existing role preserved. Manual resolution required.', v_user.id, v_user.normalized_email;
    ELSE
      -- Case 3: Profile exists, verified Google identity, no permanent role -> Assign SUPER_ADMIN
      INSERT INTO public.user_roles (user_id, role, assigned_by, created_at)
      VALUES (v_user.id, 'SUPER_ADMIN'::public.app_role, v_user.id, NOW())
      ON CONFLICT (user_id, role) DO NOTHING;

      RAISE NOTICE 'Reconciliation Success: Assigned SUPER_ADMIN to user % (%).', v_user.id, v_user.normalized_email;
    END IF;
  END LOOP;
END $$;
