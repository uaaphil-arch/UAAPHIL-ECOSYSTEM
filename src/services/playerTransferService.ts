/**
 * PATCH-001-P36: PLAYER TRANSFER SERVICE
 * 
 * Interacts with authoritative Supabase RPCs for Player Transfer lifecycle:
 * - request_player_transfer
 * - approve_outgoing_transfer
 * - approve_incoming_transfer
 * - reject_player_transfer
 * - cancel_player_transfer
 * - direct_execute_player_transfer
 * - get_pending_club_transfers
 * - get_player_transfer_history
 */

import { supabase } from '../lib/supabase';
import {
  ClubPendingTransferItem,
  PartitionedClubPendingTransfers,
  PlayerTransferHistoryItem,
  TransferRpcResponse,
} from '../types/playerTransfer';

export const playerTransferService = {
  /**
   * Request transfer to target club as the authenticated player
   */
  async requestTransfer(toClubId: string, reason?: string): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('request_player_transfer', {
      p_to_club_id: toClubId,
      p_reason: reason || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to submit transfer request');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Approve outgoing release (Outgoing Club Coach or Super Admin)
   */
  async approveOutgoingTransfer(transferId: string, notes?: string): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('approve_outgoing_transfer', {
      p_transfer_id: transferId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to approve outgoing transfer');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Approve incoming acceptance & atomically execute transfer (Incoming Club Coach or Super Admin)
   */
  async approveIncomingTransfer(transferId: string, notes?: string): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('approve_incoming_transfer', {
      p_transfer_id: transferId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to approve incoming transfer');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Reject a transfer request (Outgoing Coach, Incoming Coach, or Super Admin)
   */
  async rejectTransfer(transferId: string, reason?: string): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('reject_player_transfer', {
      p_transfer_id: transferId,
      p_reason: reason || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to reject transfer request');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Cancel a pending transfer request (Initiating player or Super Admin)
   */
  async cancelTransfer(transferId: string, reason?: string): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('cancel_player_transfer', {
      p_transfer_id: transferId,
      p_reason: reason || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to cancel transfer request');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Super Admin direct atomic transfer execution
   */
  async directExecuteTransfer(
    playerUserId: string,
    toClubId: string,
    notes?: string
  ): Promise<TransferRpcResponse> {
    const { data, error } = await supabase.rpc('direct_execute_player_transfer', {
      p_player_user_id: playerUserId,
      p_to_club_id: toClubId,
      p_notes: notes || null,
    });

    if (error) {
      throw new Error(error.message || 'Failed to directly execute player transfer');
    }
    return data as TransferRpcResponse;
  },

  /**
   * Get pending transfers for a club (outgoing + incoming)
   */
  async getPendingClubTransfers(clubId: string): Promise<ClubPendingTransferItem[]> {
    const { data, error } = await supabase.rpc('get_pending_club_transfers', {
      p_club_id: clubId,
    });

    if (error) {
      console.error('Error fetching pending club transfers:', error);
      throw new Error(error.message || 'Failed to fetch pending club transfers');
    }

    if (data === null || data === undefined) {
      return [];
    }

    // Case A: Legacy / Flat Array Response
    if (Array.isArray(data)) {
      return data as ClubPendingTransferItem[];
    }

    // Case B: Partitioned JSONB Object Response { incoming_pending?: [...], outgoing_pending?: [...] }
    if (typeof data === 'object') {
      const partitioned = data as PartitionedClubPendingTransfers;
      const hasIncoming = Array.isArray(partitioned.incoming_pending);
      const hasOutgoing = Array.isArray(partitioned.outgoing_pending);

      if (hasIncoming || hasOutgoing) {
        const incoming: ClubPendingTransferItem[] = hasIncoming ? partitioned.incoming_pending! : [];
        const outgoing: ClubPendingTransferItem[] = hasOutgoing ? partitioned.outgoing_pending! : [];

        const combined = [...incoming, ...outgoing];
        // Deduplicate by transfer id if any overlap exists
        const seen = new Set<string>();
        const deduplicated: ClubPendingTransferItem[] = [];
        for (const item of combined) {
          if (item && typeof item === 'object' && typeof item.id === 'string') {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              deduplicated.push(item);
            }
          } else if (item) {
            deduplicated.push(item);
          }
        }
        return deduplicated;
      }
    }

    console.warn('Unexpected non-array data returned for pending club transfers:', data);
    return [];
  },

  /**
   * Get player's historical transfer requests
   */
  async getPlayerTransferHistory(playerUserId: string): Promise<PlayerTransferHistoryItem[]> {
    const { data, error } = await supabase.rpc('get_player_transfer_history', {
      p_player_user_id: playerUserId,
    });

    if (error) {
      console.error('Error fetching player transfer history:', error);
      throw new Error(error.message || 'Failed to fetch player transfer history');
    }
    if (Array.isArray(data)) {
      return data as PlayerTransferHistoryItem[];
    }
    console.warn('Unexpected non-array data returned for player transfer history:', data);
    return [];
  },
};
