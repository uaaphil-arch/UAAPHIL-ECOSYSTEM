-- ==============================================================================
-- CORRECTIVE MIGRATION: 20260818000025_revoke_service_role_execute.sql
-- Domain: Club & Coach Succession ACL Correction
-- Project: UAAPHIL Tournament System
-- Target: Supabase / PostgreSQL 15+
-- Sequence: 000025 (Additive, Targeted Privilege Hardening)
-- Applies strictly AFTER: 20260818000024_harden_club_and_coach_security.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- EXPLICIT REVOCATION OF EXECUTE PRIVILEGES FROM service_role
-- Scoped strictly to the 9 club & coach succession stored procedures.
-- Does NOT affect postgres ownership or authenticated privileges.
-- ------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.get_coach_team_authority(UUID, UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.request_coach_succession(UUID, UUID, TEXT, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.approve_coach_succession(UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.reject_coach_succession(UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.direct_assign_club_coach(UUID, UUID, TEXT, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.get_club_active_coach(UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.get_club_coach_history(UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.get_pending_coach_successions() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) FROM service_role;
