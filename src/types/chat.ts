import { AppRole } from './roles';

export type ChatRoomType = 'GLOBAL' | 'TOURNAMENT';

export interface ChatRoom {
  id: string;
  room_type: ChatRoomType;
  tournament_id: string | null;
  title: string;
  description: string | null;
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  retention_days: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Optional enriched context
  tournament_name?: string;
  tournament_status?: string;
  unread_count?: number;
  last_message?: ChatMessage | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_deleted: boolean;
  deleted_by: string | null;
  deleted_at: string | null;
  deleted_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSenderProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email?: string | null;
}

export interface ChatMessageWithSender extends ChatMessage {
  sender?: ChatSenderProfile | null;
  sender_roles?: AppRole[];
}

export interface ChatReadState {
  room_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: string;
}

export interface SendChatMessageInput {
  room_id: string;
  content: string;
}

export interface ModerateMessageInput {
  message_id: string;
  room_id: string;
  reason: string;
}

export interface CreateTournamentRoomInput {
  tournament_id: string;
  title?: string;
  description?: string;
}

export interface CreateGlobalRoomInput {
  title?: string;
  description?: string;
  retention_days?: number;
}

export type ChatRestrictionType = 'BAN' | 'MUTE' | 'TIMEOUT';
export type ChatRestrictionScope = 'GLOBAL' | 'TOURNAMENT' | 'ALL_CHAT';

export interface ChatUserRestriction {
  id: string;
  user_id: string;
  restriction_type: ChatRestrictionType;
  scope: ChatRestrictionScope;
  tournament_id: string | null;
  reason: string;
  restricted_by: string;
  restricted_at: string;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  // Enriched context
  user_name?: string | null;
  restricted_by_name?: string | null;
}

export interface RestrictUserInput {
  target_user_id: string;
  restriction_type: ChatRestrictionType;
  scope: ChatRestrictionScope;
  tournament_id?: string | null;
  reason: string;
  duration_minutes?: number | null;
}

export interface RevokeRestrictionInput {
  restriction_id: string;
  revocation_reason: string;
}

export interface ChatParticipantIdentity {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  canonicalRole: string;
  roleBadge: string;
  allRoles: string[];
  clubId: string | null;
  clubName: string | null;
  teamName: string | null;
  affiliationLabel: string;
  isOfficial: boolean;
}
