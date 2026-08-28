-- Migration: Add STANDARD_MEAN to public.anyo_calc_method enum
-- Additive, safe, and backwards-compatible

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.anyo_calc_method'::regtype
    AND enumlabel = 'STANDARD_MEAN'
  ) THEN
    ALTER TYPE public.anyo_calc_method ADD VALUE 'STANDARD_MEAN';
  END IF;
END $$;
