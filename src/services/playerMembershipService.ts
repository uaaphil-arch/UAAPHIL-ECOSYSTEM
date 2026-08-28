/**
 * PATCH-001-P35: PLAYER MEMBERSHIP SERVICE
 * 
 * Interacts with authoritative Supabase RPCs for Player Membership lifecycle:
 * - request_player_membership
 * - approve_player_membership
 * - reject_player_membership
 * - relieve_player_membership
 * - direct_assign_player_membership
 * - get_player_active_membership
 * - get_club_member_roster
 * - get_player_membership_history
 */

import { supabase } from '../lib/supabase';
import {
  ActivePlayerMembership,
  ClubRosterMember,
  PlayerMembershipHistoryItem,
  MembershipRpcResponse,
  MembershipType,
  CoachAthleteSearchResult,
} from '../types/playerMembership';

export const playerMembershipService = {
  /**
   * Search for active eligible players by name (Coach/Admin scope, zero PII exposure)
   * RPC: public.search_athletes_for_coach
   */
  async searchAthletesForCoach(query: string): Promise<CoachAthleteSearchResult[]> {
    if (!query || query.trim().length < 2) return [];

    const { data, error } = await supabase.rpc('search_athletes_for_coach', {
      p_query: query.trim(),
    });

    if (error) {
      console.error('Error searching athletes for coach:', error);
      throw new Error(error.message || 'Failed to search athletes');
    }

    const rawList = (data as any[]) || [];
    return rawList.map((row) => ({
      user_id: row.user_id || row.id || '',
      full_name: row.full_name || '',
      affiliation_status: row.affiliation_status || 'UNATTACHED',
      active_club_id: row.active_club_id || null,
      active_club_name: row.active_club_name || null,
    }));
  },

  /**
   * Coach adds an existing athlete directly to active club roster
   * RPC: public.coach_add_player_membership
   */
  async coachAddPlayer(
    clubId: string,
    playerUserId: string,
    membershipType: MembershipType = 'REGULAR',
    notes?: string
  ): Promise<MembershipRpcResponse> {
    console.log('[FIND-004] RPC PAYLOAD:', {
      p_club_id: clubId,
      p_player_user_id: playerUserId,
      p_membership_type: membershipType,
      p_notes: notes || null,
    });

    const { data, error } = await supabase.rpc('coach_add_player_membership', {
      p_club_id: clubId,
      p_player_user_id: playerUserId,
      p_membership_type: membershipType,
      p_notes: notes || null,
    });

    console.log('[FIND-004] RPC DATA:', data);
    console.log('[FIND-004] RPC ERROR:', error);
    console.log('[FIND-004] RPC ERROR CODE:', error?.code);
    console.log('[FIND-004] RPC ERROR MESSAGE:', error?.message);
    console.log('[FIND-004] RPC ERROR DETAILS:', error?.details);
    console.log('[FIND-004] RPC ERROR HINT:', error?.hint);

    if (error) {
      throw new Error(error.message || 'Failed to add player to club');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Coach suspends an active player from the club
   * RPC: public.suspend_player_membership
   */
  async suspendPlayer(membershipId: string, reason: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('suspend_player_membership', {
      p_membership_id: membershipId,
      p_reason: reason || 'Suspended by coach',
    });

    if (error) {
      throw new Error(error.message || 'Failed to suspend player');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Coach restores a suspended player back to active status
   * RPC: public.restore_player_membership
   */
  async restorePlayer(membershipId: string, notes?: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('restore_player_membership', {
      p_membership_id: membershipId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to restore player');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Request membership in a club as the authenticated player
   */
  async requestMembership(clubId: string, notes?: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('request_player_membership', {
      p_club_id: clubId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to submit membership request');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Approve a pending player membership (Coach of club or Super Admin)
   */
  async approveMembership(membershipId: string, notes?: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('approve_player_membership', {
      p_membership_id: membershipId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to approve membership request');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Reject a pending player membership (Coach of club or Super Admin)
   */
  async rejectMembership(membershipId: string, notes?: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('reject_player_membership', {
      p_membership_id: membershipId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to reject membership request');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Relieve an active player membership (Coach of club, Super Admin, or Player self-resignation)
   */
  async relieveMembership(membershipId: string, reason?: string): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('relieve_player_membership', {
      p_membership_id: membershipId,
      p_reason: reason || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to relieve player membership');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Super Admin direct assignment (bypasses pending state)
   */
  async directAssignMembership(
    playerUserId: string,
    clubId: string,
    membershipType: MembershipType = 'REGULAR',
    notes?: string
  ): Promise<MembershipRpcResponse> {
    const { data, error } = await supabase.rpc('direct_assign_player_membership', {
      p_player_user_id: playerUserId,
      p_club_id: clubId,
      p_membership_type: membershipType,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to directly assign player membership');
    }
    return data as MembershipRpcResponse;
  },

  /**
   * Get active membership for a player
   */
  async getPlayerActiveMembership(playerUserId: string): Promise<ActivePlayerMembership | null> {
    const { data, error } = await supabase.rpc('get_player_active_membership', {
      p_player_user_id: playerUserId,
    });

    if (error) {
      console.error('Error fetching player active membership:', error);
      return null;
    }
    return data as ActivePlayerMembership | null;
  },

  /**
   * Get club membership roster
   */
  async getClubRoster(clubId: string, statusFilter: string = 'ACTIVE'): Promise<ClubRosterMember[]> {
    const { data, error } = await supabase.rpc('get_club_member_roster', {
      p_club_id: clubId,
      p_status_filter: statusFilter,
    });

    if (error) {
      console.error('Error fetching club roster:', error);
      return [];
    }
    return (data as ClubRosterMember[]) || [];
  },

  /**
   * Get player's historical club memberships
   */
  async getPlayerMembershipHistory(playerUserId: string): Promise<PlayerMembershipHistoryItem[]> {
    const { data, error } = await supabase.rpc('get_player_membership_history', {
      p_player_user_id: playerUserId,
    });

    if (error) {
      console.error('Error fetching player membership history:', error);
      return [];
    }
    return (data as PlayerMembershipHistoryItem[]) || [];
  },
};
