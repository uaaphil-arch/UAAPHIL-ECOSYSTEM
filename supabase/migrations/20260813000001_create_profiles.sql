-- Phase 1B: Profile Foundation Migration
-- Creates account_status ENUM, public.profiles table, RLS policies, update trigger, and auth.users trigger.

-- 1. Create account_status ENUM
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
    CREATE TYPE account_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'DEACTIVATED');
  END IF;
END $$;

-- 2. Create public.profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  phone_number TEXT,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  account_status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles(account_status);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- SELECT Policy: Authenticated users can view ONLY their own profile. Anonymous access is DENIED.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- UPDATE Policy: Authenticated users can update ONLY their own profile.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Direct INSERT Policy: Denied for all client roles (INSERT handled exclusively via DB trigger).
-- Direct DELETE Policy: Denied for all client roles.

-- 6. Trigger to enforce immutability of protected columns (id, email, account_status)
CREATE OR REPLACE FUNCTION public.check_profile_update_integrity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Modification of profile ID is prohibited.';
  END IF;
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'Modification of profile email is prohibited.';
  END IF;
  IF NEW.account_status <> OLD.account_status THEN
    RAISE EXCEPTION 'Modification of account status requires administrative authority.';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_check_profile_update_integrity ON public.profiles;
CREATE TRIGGER tr_check_profile_update_integrity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_update_integrity();

-- 7. Automatic Profile Creation Trigger on auth.users
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
    account_status,
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();
