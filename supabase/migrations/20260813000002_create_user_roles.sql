-- Phase 1C: Permanent RBAC Foundation Migration
-- Creates app_role ENUM, public.user_roles table, indexes, and read-only RLS policy.

-- 1. Create app_role ENUM
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'COACH');
  END IF;
END $$;

-- 2. Create public.user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role)
);

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles(role);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- SELECT Policy: Authenticated users can read ONLY their own permanent roles. Anonymous read DENIED.
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Direct INSERT, UPDATE, DELETE Policies: DENIED by RLS default-deny behavior for all client roles.
