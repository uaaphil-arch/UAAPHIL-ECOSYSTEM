/**
 * PATCH-001-P35: PLAYER MEMBERSHIP DOMAIN TYPES
 */

export type MembershipStatus = 
  | 'PENDING' 
  | 'ACTIVE' 
  | 'RELIEVED' 
  | 'TRANSFERRED' 
  | 'SUSPENDED' 
  | 'REJECTED';

export type MembershipType = 
  | 'REGULAR' 
  | 'STUDENT_ATHLETE' 
  | 'VARSITY' 
  | 'ALUMNI';

export interface ClubMembership {
  id: string;
  player_user_id: string;
  club_id: string;
  status: MembershipStatus;
  membership_type: MembershipType;
  effective_from: string | null;
  effective_to: string | null;
  requested_by: string;
  approved_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivePlayerMembership {
  membership_id: string;
  player_user_id: string;
  club_id: string;
  club_name: string;
  club_code?: string | null;
  club_logo_url?: string | null;
  status: MembershipStatus;
  membership_type: MembershipType;
  effective_from: string;
  created_at: string;
}

export interface ClubRosterMember {
  membership_id: string;
  player_user_id: string;
  full_name: string;
  email?: string | null;
  club_id: string;
  status: MembershipStatus;
  membership_type: MembershipType;
  effective_from: string | null;
  effective_to: string | null;
  requested_by: string;
  approved_by: string | null;
  reviewed_at: string | null;
  review_notes?: string | null;
  created_at: string;
}

export interface PlayerMembershipHistoryItem {
  membership_id: string;
  player_user_id: string;
  club_id: string;
  club_name: string;
  club_code?: string | null;
  club_logo_url?: string | null;
  status: MembershipStatus;
  membership_type: MembershipType;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

export interface MembershipRpcResponse {
  success: boolean;
  membership_id?: string;
  status?: MembershipStatus;
  effective_from?: string;
  effective_to?: string;
  message?: string;
  error?: string;
}

export interface CoachAthleteSearchResult {
  user_id: string;
  id?: string;
  full_name: string;
  affiliation_status: 'ACTIVE_MEMBER' | 'PENDING_MEMBER' | 'SUSPENDED_MEMBER' | 'UNATTACHED';
  active_club_id: string | null;
  active_club_name: string | null;
}

export interface SetEventLineupPayload {
  event_id: string;
  club_id: string;
  lineup_user_ids: string[];
  reserve_user_ids: string[];
}

export interface SwapLineupPayload {
  event_id: string;
  club_id: string;
  lineup_reg_id: string;
  reserve_reg_id: string;
}

export interface LineupRpcResponse {
  success: boolean;
  event_id?: string;
  club_id?: string;
  lineup_count?: number;
  reserve_count?: number;
  message?: string;
  error?: string;
}
