/**
 * PATCH-001-P36: PLAYER TRANSFER DOMAIN TYPES
 */

export type TransferStatus =
  | 'PENDING_OUTGOING_RELEASE'
  | 'PENDING_INCOMING_ACCEPTANCE'
  | 'APPROVED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export interface PlayerTransferRequest {
  id: string;
  player_user_id: string;
  from_club_id: string;
  to_club_id: string;
  status: TransferStatus;
  requested_by: string;
  outgoing_approved_by?: string | null;
  outgoing_reviewed_at?: string | null;
  incoming_approved_by?: string | null;
  incoming_reviewed_at?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  reason?: string | null;
  review_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClubPendingTransferItem {
  id: string;
  player_user_id: string;
  player_name: string;
  from_club_id: string;
  from_club_name: string;
  to_club_id: string;
  to_club_name: string;
  status: TransferStatus;
  requested_by: string;
  reason?: string | null;
  review_notes?: string | null;
  outgoing_approved_by?: string | null;
  outgoing_reviewed_at?: string | null;
  incoming_approved_by?: string | null;
  incoming_reviewed_at?: string | null;
  created_at: string;
  transfer_direction: 'OUTGOING' | 'INCOMING';
}

export interface PartitionedClubPendingTransfers {
  incoming_pending?: ClubPendingTransferItem[];
  outgoing_pending?: ClubPendingTransferItem[];
}

export interface PlayerTransferHistoryItem {
  id: string;
  player_user_id: string;
  from_club_id: string;
  from_club_name: string;
  to_club_id: string;
  to_club_name: string;
  status: TransferStatus;
  reason?: string | null;
  review_notes?: string | null;
  completed_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
}

export interface TransferRpcResponse {
  success: boolean;
  transfer_id?: string;
  status?: TransferStatus;
  new_membership_id?: string;
  effective_timestamp?: string;
  from_club_id?: string;
  to_club_id?: string;
  message?: string;
  error?: string;
}
