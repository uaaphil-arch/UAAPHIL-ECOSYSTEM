/**
 * Domain types for normalized Club identity, Coach-Club authority, and Coach Succession workflows.
 * Phase 6 / PATCH-001-P32
 */

export type CoachRoleType = 'HEAD_COACH' | 'ASSISTANT_COACH';
export type CoachAssignmentStatus = 'ACTIVE' | 'RELIEVED' | 'REVOKED' | 'TRANSFER_OUT';
export type SuccessionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ClubGovernanceStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface Club {
  id: string;
  name: string;
  code?: string | null;
  short_name?: string | null;
  logo_url?: string | null;
  street_address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  is_active: boolean;
  governance_status?: ClubGovernanceStatus;
  banned_at?: string | null;
  ban_until?: string | null;
  banned_by?: string | null;
  ban_reason?: string | null;
  ban_notes?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateClubProfilePayload {
  clubId: string;
  shortName?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  logoUrl?: string | null;
}

export interface CreateClubPayload {
  name: string;
  code?: string;
  shortName?: string;
  streetAddress?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  logoFile?: File | null;
}

export interface ClubDeletionSafetyCheck {
  can_delete: boolean;
  club_id: string;
  club_name: string;
  dependencies: {
    coaches: number;
    memberships: number;
    transfers: number;
    successions: number;
    registrations: number;
  };
  blocking_reasons: string[];
  recommendation: string;
}

export interface ClubCoachAssignment {
  id: string;
  club_id: string;
  coach_user_id: string;
  coach_name?: string | null;
  coach_email?: string | null;
  role_type: CoachRoleType;
  status: CoachAssignmentStatus;
  effective_from: string;
  effective_to?: string | null;
  appointed_by_name?: string | null;
  relieved_by_name?: string | null;
  notes?: string | null;
}

export interface ActiveClubCoach {
  assignment_id: string;
  club_id: string;
  coach_user_id: string;
  role_type: CoachRoleType;
  status: CoachAssignmentStatus;
  effective_from: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
  appointed_by: string;
}

export interface CoachSuccessionRequest {
  id: string;
  club_id: string;
  club_name: string;
  club_code?: string | null;
  outgoing_coach_id?: string | null;
  outgoing_coach_name?: string | null;
  incoming_coach_id: string;
  incoming_coach_name?: string | null;
  incoming_coach_email?: string | null;
  role_type: CoachRoleType;
  status: SuccessionRequestStatus;
  reason?: string | null;
  requested_by_id: string;
  requested_by_name?: string | null;
  created_at: string;
  reviewed_by_id?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
}

export interface AssignedCoachClub {
  assignment_id: string;
  club_id: string;
  role_type: CoachRoleType;
  status: CoachAssignmentStatus;
  effective_from: string;
  effective_to?: string | null;
  club: Club;
}

export interface SuccessionOperationResult {
  success: boolean;
  action: string;
  request_id?: string;
  assignment_id?: string;
  club_id?: string;
  outgoing_coach_id?: string | null;
  incoming_coach_id?: string;
  role_type?: CoachRoleType;
  error?: string;
}
