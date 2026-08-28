import { supabase } from '../lib/supabase';
import { roleService } from './roleService';
import {
  ChatRoom,
  ChatMessage,
  ChatMessageWithSender,
  ChatReadState,
  SendChatMessageInput,
  ModerateMessageInput,
  CreateTournamentRoomInput,
  CreateGlobalRoomInput,
  ChatUserRestriction,
  RestrictUserInput,
  RevokeRestrictionInput,
  ChatRestrictionScope,
} from '../types/chat';
import { AppRole } from '../types/roles';

// In-memory cache for profile & role lookups to minimize duplicate network queries
const senderProfileCache = new Map<string, { full_name: string | null; avatar_url: string | null }>();
const senderRolesCache = new Map<string, AppRole[]>();

export const chatService = {
  /**
   * Fetches all chat rooms that the authenticated user is authorized to discover and access.
   * Leverages Supabase RLS ('chat_rooms_select' via can_access_chat_room helper).
   */
  async fetchAccessibleRooms(): Promise<ChatRoom[]> {
    try {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select(`
          id,
          room_type,
          tournament_id,
          title,
          description,
          is_archived,
          archived_at,
          archived_by,
          retention_days,
          created_by,
          created_at,
          updated_at,
          tournaments:tournament_id (
            name,
            status
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching accessible chat rooms:', error.message);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        room_type: row.room_type,
        tournament_id: row.tournament_id,
        title: row.title,
        description: row.description,
        is_archived: row.is_archived,
        archived_at: row.archived_at,
        archived_by: row.archived_by,
        retention_days: row.retention_days,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tournament_name: row.tournaments?.name,
        tournament_status: row.tournaments?.status,
      }));
    } catch (err: unknown) {
      console.error('Failed to retrieve accessible chat rooms:', err);
      throw err;
    }
  },

  /**
   * Fetches the unique Global Chat Room.
   * STRICTLY READ-ONLY: Performs a SELECT query only. Never attempts implicit creation.
   */
  async fetchGlobalRoom(): Promise<ChatRoom | null> {
    try {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select('*')
        .eq('room_type', 'GLOBAL')
        .maybeSingle();

      if (error) {
        console.warn('Error fetching global chat room:', error.message);
        throw error;
      }

      if (data) {
        return data as ChatRoom;
      }

      return null;
    } catch (err: unknown) {
      console.warn('Unable to retrieve global room:', err);
      return null;
    }
  },

  /**
   * Initializes or creates the single official UAAPHIL Global Chat Room.
   * Only accessible to Admins and Super Admins per RLS ('chat_rooms_insert' policy).
   * Hardened for idempotency: pre-checks existing room, handles duplicate conflict safely,
   * preserves standalone INSERT without chained RETURNING, and retrieves via authenticated SELECT.
   */
  async createGlobalRoom(input?: CreateGlobalRoomInput): Promise<ChatRoom> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userData?.user || userError) {
      throw new Error('Authentication required to initialize the global chat room.');
    }

    // Defense-in-depth authorization check: user must be ADMIN or SUPER_ADMIN
    const roles = await roleService.fetchMyRoles(userData.user.id);
    const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can initialize the global chat room.');
    }

    // [GLOBAL_CHAT_IDEMPOTENCY_PRECHECK] Check if official global room already exists
    console.log('[GLOBAL_CHAT_IDEMPOTENCY_PRECHECK]', {
      userId: userData.user.id,
    });

    const existingRoom = await this.fetchGlobalRoom();
    if (existingRoom) {
      console.log('[GLOBAL_CHAT_IDEMPOTENCY_EXISTING_ROOM]', {
        roomId: existingRoom.id,
        title: existingRoom.title,
      });
      return existingRoom;
    }

    const defaultTitle = input?.title?.trim() || 'UAAPHIL Official Global Channel';
    const defaultDescription =
      input?.description?.trim() ||
      'Official UAAPHIL-wide communication forum for announcements and coordination.';
    const retentionDays = input?.retention_days ?? 60;

    const insertPayload = {
      room_type: 'GLOBAL' as const,
      tournament_id: null,
      title: defaultTitle.slice(0, 150),
      description: defaultDescription,
      retention_days: retentionDays,
      created_by: userData.user.id,
    };

    // [GLOBAL_CHAT_IDEMPOTENCY_CREATE_START] Dispatch standalone INSERT
    console.log('[GLOBAL_CHAT_IDEMPOTENCY_CREATE_START]', {
      createdBy: insertPayload.created_by,
      roomType: insertPayload.room_type,
      retentionDays: insertPayload.retention_days,
    });

    // Step C: Perform standalone INSERT without chained .select().single() (prevents 42501)
    const { error: insertError } = await supabase
      .from('chat_rooms')
      .insert(insertPayload);

    if (insertError) {
      const isConflict =
        insertError.code === '23505' ||
        (insertError.message &&
          (insertError.message.includes('unique') ||
            insertError.message.includes('duplicate') ||
            insertError.message.includes('uq_global_chat_room') ||
            insertError.message.includes('already exists')));

      if (isConflict) {
        // [GLOBAL_CHAT_IDEMPOTENCY_CONFLICT_RECOVERY] Concurrent create or duplicate insertion caught
        console.log('[GLOBAL_CHAT_IDEMPOTENCY_CONFLICT_RECOVERY]', {
          code: insertError.code,
          message: insertError.message,
        });

        const recoveredRoom = await this.fetchGlobalRoom();
        if (recoveredRoom) {
          return recoveredRoom;
        }
      }

      console.error('[GLOBAL_CHAT_IDEMPOTENCY_FAILURE]', {
        stage: 'INSERT',
        code: insertError.code,
        message: insertError.message,
      });
      throw new Error(insertError.message || 'Failed to initialize global chat room.');
    }

    // [GLOBAL_CHAT_IDEMPOTENCY_CREATE_SUCCESS]
    console.log('[GLOBAL_CHAT_IDEMPOTENCY_CREATE_SUCCESS]', {
      createdBy: insertPayload.created_by,
    });

    // [GLOBAL_CHAT_IDEMPOTENCY_POST_CREATE_READ] Step E: Separate authenticated SELECT query
    console.log('[GLOBAL_CHAT_IDEMPOTENCY_POST_CREATE_READ]');

    let createdRoom = await this.fetchGlobalRoom();

    // Fallback retry if read replica / query has microsecond latency
    if (!createdRoom) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      createdRoom = await this.fetchGlobalRoom();
    }

    if (createdRoom) {
      return createdRoom;
    }

    console.error('[GLOBAL_CHAT_IDEMPOTENCY_FAILURE]', {
      stage: 'POST_CREATE_READ',
    });
    throw new Error('Global chat room was created but could not be retrieved. Please refresh your channels.');
  },

  /**
   * Fetches the authorized tournament chat room for a specific tournament.
   */
  async fetchTournamentRoom(tournamentId: string): Promise<ChatRoom | null> {
    if (!tournamentId) return null;

    try {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select(`
          *,
          tournaments:tournament_id (
            name,
            status
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('room_type', 'TOURNAMENT')
        .maybeSingle();

      if (error) {
        // May be permission denied (42501) if user is not authorized
        console.warn(`Cannot access tournament chat room for tournament ${tournamentId}:`, error.message);
        return null;
      }

      if (!data) return null;

      return {
        id: data.id,
        room_type: data.room_type,
        tournament_id: data.tournament_id,
        title: data.title,
        description: data.description,
        is_archived: data.is_archived,
        archived_at: data.archived_at,
        archived_by: data.archived_by,
        retention_days: data.retention_days,
        created_by: data.created_by,
        created_at: data.created_at,
        updated_at: data.updated_at,
        tournament_name: data.tournaments?.name,
        tournament_status: data.tournaments?.status,
      };
    } catch (err: unknown) {
      console.warn(`Failed to fetch tournament chat room:`, err);
      return null;
    }
  },

  /**
   * Initializes or creates a tournament chat room for an existing tournament.
   * Only accessible to Tournament Organizers and Admins per RLS.
   * Hardened for idempotency: pre-checks existing room, handles duplicate conflict safely,
   * preserves standalone INSERT without chained RETURNING, and retrieves via authenticated SELECT.
   */
  async createTournamentRoom(input: CreateTournamentRoomInput): Promise<ChatRoom> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userData?.user) {
      throw new Error('Authentication required to create a tournament chat room.');
    }

    const { data: tournament, error: tourneyError } = await supabase
      .from('tournaments')
      .select('name, organizer_id')
      .eq('id', input.tournament_id)
      .single();

    if (tourneyError || !tournament) {
      throw new Error('Tournament not found or inaccessible.');
    }

    // Defense-in-depth authorization check: user must be ADMIN/SUPER_ADMIN or the tournament organizer
    const roles = await roleService.fetchMyRoles(userData.user.id);
    const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');

    if (!isAdmin && tournament.organizer_id !== userData.user.id) {
      throw new Error('Unauthorized: Only the tournament organizer or an administrator can initialize this tournament chat room.');
    }

    // [CHAT_IDEMPOTENCY_PRECHECK] Check if official tournament room already exists
    console.log('[CHAT_IDEMPOTENCY_PRECHECK]', {
      tournamentId: input.tournament_id,
      userId: userData.user.id,
    });

    const existingRoom = await this.fetchTournamentRoom(input.tournament_id);
    if (existingRoom) {
      console.log('[CHAT_IDEMPOTENCY_EXISTING_ROOM]', {
        tournamentId: input.tournament_id,
        roomId: existingRoom.id,
        title: existingRoom.title,
      });
      return existingRoom;
    }

    const defaultTitle = input.title?.trim() || `${tournament.name} Official Channel`;
    const defaultDescription =
      input.description?.trim() ||
      `Official tournament coordination and announcements channel for ${tournament.name}.`;

    const insertPayload = {
      room_type: 'TOURNAMENT' as const,
      tournament_id: input.tournament_id,
      title: defaultTitle.slice(0, 150),
      description: defaultDescription,
      retention_days: 60,
      created_by: userData.user.id,
    };

    // [CHAT_IDEMPOTENCY_CREATE_START] Dispatch standalone INSERT
    console.log('[CHAT_IDEMPOTENCY_CREATE_START]', {
      tournamentId: insertPayload.tournament_id,
      createdBy: insertPayload.created_by,
      roomType: insertPayload.room_type,
    });

    // Step A: Perform standalone INSERT without chained .select().single() (prevents 42501)
    const { error: insertError } = await supabase
      .from('chat_rooms')
      .insert(insertPayload);

    if (insertError) {
      const isConflict =
        insertError.code === '23505' ||
        (insertError.message &&
          (insertError.message.includes('unique') ||
            insertError.message.includes('duplicate') ||
            insertError.message.includes('uq_single_active_tournament_chat') ||
            insertError.message.includes('already exists')));

      if (isConflict) {
        // [CHAT_IDEMPOTENCY_CONFLICT_RECOVERY] Concurrent create or duplicate insertion caught
        console.log('[CHAT_IDEMPOTENCY_CONFLICT_RECOVERY]', {
          tournamentId: input.tournament_id,
          code: insertError.code,
          message: insertError.message,
        });

        const recoveredRoom = await this.fetchTournamentRoom(input.tournament_id);
        if (recoveredRoom) {
          return recoveredRoom;
        }
      }

      console.error('[CHAT_IDEMPOTENCY_FAILURE]', {
        stage: 'INSERT',
        tournamentId: input.tournament_id,
        code: insertError.code,
        message: insertError.message,
      });
      throw new Error(insertError.message || 'Failed to create tournament chat room.');
    }

    // [CHAT_IDEMPOTENCY_CREATE_SUCCESS]
    console.log('[CHAT_IDEMPOTENCY_CREATE_SUCCESS]', {
      tournamentId: insertPayload.tournament_id,
      createdBy: insertPayload.created_by,
    });

    // [CHAT_IDEMPOTENCY_POST_CREATE_READ] Step B: Separate authenticated SELECT query
    console.log('[CHAT_IDEMPOTENCY_POST_CREATE_READ]', {
      tournamentId: input.tournament_id,
    });

    let createdRoom = await this.fetchTournamentRoom(input.tournament_id);

    // Fallback retry if read replica / query has microsecond latency
    if (!createdRoom) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      createdRoom = await this.fetchTournamentRoom(input.tournament_id);
    }

    if (createdRoom) {
      return createdRoom;
    }

    console.error('[CHAT_IDEMPOTENCY_FAILURE]', {
      stage: 'POST_CREATE_READ',
      tournamentId: input.tournament_id,
    });
    throw new Error('Tournament chat room was created but could not be retrieved. Please refresh your channels.');
  },

  /**
   * Loads messages for an authorized room with deterministic sorting and sender enrichment.
   * Ordering: created_at ASC, id ASC.
   * Supports pagination using beforeCreatedAt.
   */
  async fetchRoomMessages(
    roomId: string,
    limit: number = 50,
    beforeCreatedAt?: string
  ): Promise<ChatMessageWithSender[]> {
    if (!roomId) return [];

    try {
      let query = supabase
        .from('chat_messages')
        .select(`
          id,
          room_id,
          sender_id,
          content,
          is_deleted,
          deleted_by,
          deleted_at,
          deleted_reason,
          created_at,
          updated_at
        `)
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (beforeCreatedAt) {
        query = query.lt('created_at', beforeCreatedAt);
      }

      const { data, error } = await query;

      if (error) {
        console.warn(`Error fetching messages for room ${roomId}:`, error.message);
        throw error;
      }

      if (!data || data.length === 0) return [];

      // Sort chronological ascending (oldest to newest for chat timeline display)
      const sortedMessages: ChatMessage[] = data.reverse();

      // Collect unique sender IDs to batch load profiles & roles
      const senderIds = Array.from(new Set(sortedMessages.map((m) => m.sender_id)));
      await this.preloadSenderProfilesAndRoles(senderIds);

      return sortedMessages.map((msg) => ({
        ...msg,
        sender: senderProfileCache.get(msg.sender_id)
          ? {
              id: msg.sender_id,
              full_name: senderProfileCache.get(msg.sender_id)?.full_name || null,
              avatar_url: senderProfileCache.get(msg.sender_id)?.avatar_url || null,
            }
          : null,
        sender_roles: senderRolesCache.get(msg.sender_id) || [],
      }));
    } catch (err: unknown) {
      console.error('Failed to fetch room messages:', err);
      throw err;
    }
  },

  /**
   * Helper to batch preload sender profiles and roles into memory cache.
   */
  async preloadSenderProfilesAndRoles(senderIds: string[]): Promise<void> {
    const missingIds = senderIds.filter((id) => !senderProfileCache.has(id));
    if (missingIds.length === 0) return;

    try {
      // 1. Fetch missing profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', missingIds);

      if (profiles) {
        profiles.forEach((p: any) => {
          senderProfileCache.set(p.id, {
            full_name: p.full_name,
            avatar_url: p.avatar_url,
          });
        });
      }

      // 2. Fetch missing permanent roles
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', missingIds);

      if (roles) {
        const rolesByUser = new Map<string, AppRole[]>();
        roles.forEach((r: any) => {
          const current = rolesByUser.get(r.user_id) || [];
          current.push(r.role as AppRole);
          rolesByUser.set(r.user_id, current);
        });

        missingIds.forEach((id) => {
          senderRolesCache.set(id, rolesByUser.get(id) || []);
        });
      }
    } catch (err) {
      console.warn('Failed to batch load sender profiles:', err);
    }
  },

  /**
   * Sends a new chat message through the authenticated Supabase client.
   * Sender identity is strictly derived from the authenticated session.
   */
  async sendMessage(input: SendChatMessageInput): Promise<ChatMessageWithSender> {
    const trimmed = input.content.trim();
    if (!trimmed) {
      throw new Error('Message content cannot be empty.');
    }
    if (trimmed.length > 2000) {
      throw new Error('Message content exceeds maximum allowed length of 2,000 characters.');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      throw new Error('You must be signed in to send a message.');
    }

    const userId = userData.user.id;

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        room_id: input.room_id,
        sender_id: userId,
        content: trimmed,
        is_deleted: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to send message:', error);
      if (error.code === '42501') {
        throw new Error('Permission denied: You are not authorized to send messages in this room or it is archived.');
      }
      throw new Error(error.message || 'Failed to send message.');
    }

    // Ensure sender profile is preloaded
    await this.preloadSenderProfilesAndRoles([userId]);

    return {
      ...(data as ChatMessage),
      sender: senderProfileCache.get(userId)
        ? {
            id: userId,
            full_name: senderProfileCache.get(userId)?.full_name || null,
            avatar_url: senderProfileCache.get(userId)?.avatar_url || null,
          }
        : null,
      sender_roles: senderRolesCache.get(userId) || [],
    };
  },

  /**
   * Fetches the current user's read state for a specific room.
   */
  async fetchMyReadState(roomId: string): Promise<ChatReadState | null> {
    if (!roomId) return null;

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return null;

      const { data, error } = await supabase
        .from('chat_read_states')
        .select('*')
        .eq('room_id', roomId)
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (error) {
        console.warn(`Error fetching read state for room ${roomId}:`, error.message);
        return null;
      }

      return data as ChatReadState | null;
    } catch (err) {
      console.warn('Failed to fetch read state:', err);
      return null;
    }
  },

  /**
   * Updates or creates the user's own read cursor for a room.
   * Respects composite FK constraint (room_id, last_read_message_id) -> chat_messages(room_id, id).
   */
  async updateMyReadState(roomId: string, lastReadMessageId?: string | null): Promise<boolean> {
    if (!roomId) return false;

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return false;

      const userId = userData.user.id;
      const nowIso = new Date().toISOString();

      const payload: {
        room_id: string;
        user_id: string;
        last_read_message_id?: string | null;
        last_read_at: string;
      } = {
        room_id: roomId,
        user_id: userId,
        last_read_at: nowIso,
      };

      if (lastReadMessageId) {
        payload.last_read_message_id = lastReadMessageId;
      }

      const { error } = await supabase.from('chat_read_states').upsert(payload, {
        onConflict: 'room_id,user_id',
      });

      if (error) {
        console.warn('Failed to upsert chat read state:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('Error updating read state:', err);
      return false;
    }
  },

  /**
   * Moderator soft-delete for inappropriate or rule-violating messages.
   * Strictly populates required deletion metadata per chk_chat_message_deletion constraint:
   * (is_deleted = TRUE AND deleted_at IS NOT NULL).
   */
  async softDeleteMessage(input: ModerateMessageInput): Promise<boolean> {
    if (!input.message_id || !input.room_id) {
      throw new Error('Message ID and Room ID are required for moderation.');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      throw new Error('Authentication required to perform moderation.');
    }

    const userId = userData.user.id;
    const trimmedReason = input.reason.trim() || 'Content removed by tournament official or moderator.';

    const { error } = await supabase
      .from('chat_messages')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        deleted_reason: trimmedReason,
      })
      .eq('id', input.message_id)
      .eq('room_id', input.room_id);

    if (error) {
      console.error('Failed to moderate message:', error);
      if (error.code === '42501') {
        throw new Error('Permission denied: You do not have moderator authority over this chat room.');
      }
      throw new Error(error.message || 'Failed to soft delete message.');
    }

    return true;
  },

  /**
   * Toggles the archive status of a room (moderator/admin only).
   */
  async toggleRoomArchived(roomId: string, shouldArchive: boolean): Promise<boolean> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      throw new Error('Authentication required.');
    }

    const userId = userData.user.id;

    const { error } = await supabase
      .from('chat_rooms')
      .update({
        is_archived: shouldArchive,
        archived_at: shouldArchive ? new Date().toISOString() : null,
        archived_by: shouldArchive ? userId : null,
      })
      .eq('id', roomId);

    if (error) {
      console.error('Failed to toggle room archive state:', error);
      throw new Error(error.message || 'Failed to update room archive state.');
    }

    return true;
  },

  /**
   * Subscribes to Supabase Realtime changes for messages in the active room.
   * Cleans up automatically on unsubscribe.
   */
  subscribeToRoomMessages(
    roomId: string,
    onInsert: (message: ChatMessageWithSender) => void,
    onUpdate: (message: ChatMessageWithSender) => void
  ): () => void {
    if (!roomId) return () => {};

    const channelName = `chat_room_${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const rawMsg = payload.new as ChatMessage;
          // Preload sender profile if not cached
          await this.preloadSenderProfilesAndRoles([rawMsg.sender_id]);
          const enriched: ChatMessageWithSender = {
            ...rawMsg,
            sender: senderProfileCache.get(rawMsg.sender_id)
              ? {
                  id: rawMsg.sender_id,
                  full_name: senderProfileCache.get(rawMsg.sender_id)?.full_name || null,
                  avatar_url: senderProfileCache.get(rawMsg.sender_id)?.avatar_url || null,
                }
              : null,
            sender_roles: senderRolesCache.get(rawMsg.sender_id) || [],
          };
          onInsert(enriched);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const rawMsg = payload.new as ChatMessage;
          await this.preloadSenderProfilesAndRoles([rawMsg.sender_id]);
          const enriched: ChatMessageWithSender = {
            ...rawMsg,
            sender: senderProfileCache.get(rawMsg.sender_id)
              ? {
                  id: rawMsg.sender_id,
                  full_name: senderProfileCache.get(rawMsg.sender_id)?.full_name || null,
                  avatar_url: senderProfileCache.get(rawMsg.sender_id)?.avatar_url || null,
                }
              : null,
            sender_roles: senderRolesCache.get(rawMsg.sender_id) || [],
          };
          onUpdate(enriched);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Channel connected
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`Realtime channel error for room ${roomId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Authoritative Security Definer RPC: Restricts a chat participant (BAN, MUTE, TIMEOUT).
   * Enforces role hierarchy and scope containment server-side via PostgreSQL.
   */
  async restrictUser(input: RestrictUserInput): Promise<ChatUserRestriction> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userData?.user || userError) {
      throw new Error('UNAUTHORIZED: Authentication session required to issue chat restrictions.');
    }

    if (!input.target_user_id) {
      throw new Error('INVALID_ARGUMENT: Target user ID is required.');
    }

    if (!input.reason || !input.reason.trim()) {
      throw new Error('INVALID_ARGUMENT: Reason is required for disciplinary restriction.');
    }

    if (input.restriction_type === 'TIMEOUT' && (!input.duration_minutes || input.duration_minutes <= 0)) {
      throw new Error('INVALID_ARGUMENT: TIMEOUT restriction requires a positive duration in minutes.');
    }

    const { data, error } = await supabase.rpc('restrict_chat_user', {
      p_target_user_id: input.target_user_id,
      p_restriction_type: input.restriction_type,
      p_scope: input.scope,
      p_tournament_id: input.tournament_id || null,
      p_reason: input.reason.trim(),
      p_duration_minutes: input.duration_minutes || null,
    });

    if (error) {
      console.warn('restrict_chat_user RPC error:', error);
      throw new Error(error.message || 'Failed to issue chat restriction.');
    }

    return data as ChatUserRestriction;
  },

  /**
   * Authoritative Security Definer RPC: Revokes an active chat restriction.
   * Performs soft revocation (is_active = FALSE) and logs to system_audit_logs.
   */
  async revokeRestriction(input: RevokeRestrictionInput): Promise<ChatUserRestriction> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userData?.user || userError) {
      throw new Error('UNAUTHORIZED: Authentication session required to revoke chat restrictions.');
    }

    if (!input.restriction_id) {
      throw new Error('INVALID_ARGUMENT: Restriction ID is required.');
    }

    if (!input.revocation_reason || !input.revocation_reason.trim()) {
      throw new Error('INVALID_ARGUMENT: Revocation reason is required.');
    }

    const { data, error } = await supabase.rpc('revoke_chat_restriction', {
      p_restriction_id: input.restriction_id,
      p_revocation_reason: input.revocation_reason.trim(),
    });

    if (error) {
      console.warn('revoke_chat_restriction RPC error:', error);
      throw new Error(error.message || 'Failed to revoke chat restriction.');
    }

    return data as ChatUserRestriction;
  },

  /**
   * Fetches active, unexpired chat restrictions.
   * Leverages Row-Level Security policies on public.chat_user_restrictions.
   */
  async fetchActiveRestrictions(params?: {
    userId?: string;
    tournamentId?: string;
    scope?: ChatRestrictionScope;
  }): Promise<ChatUserRestriction[]> {
    try {
      let query = supabase
        .from('chat_user_restrictions')
        .select(`
          *,
          target_profile:profiles!user_id(full_name),
          moderator_profile:profiles!restricted_by(full_name)
        `)
        .eq('is_active', true)
        .order('restricted_at', { ascending: false });

      if (params?.userId) {
        query = query.eq('user_id', params.userId);
      }
      if (params?.tournamentId) {
        query = query.eq('tournament_id', params.tournamentId);
      }
      if (params?.scope) {
        query = query.eq('scope', params.scope);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('Error fetching active chat restrictions:', error.message);
        throw error;
      }

      if (!data) return [];

      const now = new Date();
      return data
        .filter((row: any) => !row.expires_at || new Date(row.expires_at) > now)
        .map((row: any) => ({
          id: row.id,
          user_id: row.user_id,
          restriction_type: row.restriction_type,
          scope: row.scope,
          tournament_id: row.tournament_id,
          reason: row.reason,
          restricted_by: row.restricted_by,
          restricted_at: row.restricted_at,
          expires_at: row.expires_at,
          is_active: row.is_active,
          revoked_at: row.revoked_at,
          revoked_by: row.revoked_by,
          revocation_reason: row.revocation_reason,
          user_name: row.target_profile?.full_name || null,
          restricted_by_name: row.moderator_profile?.full_name || null,
        }));
    } catch (err: unknown) {
      console.error('Failed to fetch active chat restrictions:', err);
      throw err;
    }
  },

  /**
   * Checks whether the current authenticated user has an active, unexpired restriction
   * covering the specified chat room.
   */
  async checkMyChatRestriction(
    roomId: string
  ): Promise<{ restricted: boolean; restriction: ChatUserRestriction | null }> {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userData?.user || userError) {
        return { restricted: false, restriction: null };
      }

      const userId = userData.user.id;

      // 1. Fetch room context to resolve room_type and tournament_id
      const { data: room, error: roomError } = await supabase
        .from('chat_rooms')
        .select('id, room_type, tournament_id')
        .eq('id', roomId)
        .maybeSingle();

      if (roomError || !room) {
        return { restricted: false, restriction: null };
      }

      // 2. Fetch active restrictions for user
      const { data: restrictions, error: restrError } = await supabase
        .from('chat_user_restrictions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (restrError || !restrictions || restrictions.length === 0) {
        return { restricted: false, restriction: null };
      }

      const now = new Date();
      // 3. Find matching unexpired restriction
      const activeMatch = restrictions.find((r: any) => {
        const isUnexpired = !r.expires_at || new Date(r.expires_at) > now;
        if (!isUnexpired) return false;

        if (r.scope === 'ALL_CHAT') return true;
        if (r.scope === 'GLOBAL' && room.room_type === 'GLOBAL') return true;
        if (
          r.scope === 'TOURNAMENT' &&
          room.room_type === 'TOURNAMENT' &&
          r.tournament_id === room.tournament_id
        ) {
          return true;
        }
        return false;
      });

      if (activeMatch) {
        return {
          restricted: true,
          restriction: {
            id: activeMatch.id,
            user_id: activeMatch.user_id,
            restriction_type: activeMatch.restriction_type,
            scope: activeMatch.scope,
            tournament_id: activeMatch.tournament_id,
            reason: activeMatch.reason,
            restricted_by: activeMatch.restricted_by,
            restricted_at: activeMatch.restricted_at,
            expires_at: activeMatch.expires_at,
            is_active: activeMatch.is_active,
            revoked_at: activeMatch.revoked_at,
            revoked_by: activeMatch.revoked_by,
            revocation_reason: activeMatch.revocation_reason,
          },
        };
      }

      return { restricted: false, restriction: null };
    } catch (err: unknown) {
      console.warn('Error checking chat restriction status:', err);
      return { restricted: false, restriction: null };
    }
  },

  /**
   * Subscribes to Supabase Realtime changes on public.chat_user_restrictions
   * strictly scoped to the specified user's ID.
   * Dispatches the callback on any INSERT, UPDATE, or DELETE event affecting this user.
   */
  subscribeToUserRestrictions(
    userId: string,
    onRestrictionChange: () => void
  ): () => void {
    if (!userId) return () => {};

    const channelName = `user_restrictions_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_user_restrictions',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          onRestrictionChange();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`Realtime channel error for user restrictions: ${userId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribes to Supabase Realtime changes on public.chat_user_restrictions
   * for moderators to keep active restrictions lists, drawers, and counter badges updated live.
   * Can be optionally filtered by tournament_id.
   */
  subscribeToActiveRestrictions(
    onRestrictionChange: () => void,
    tournamentId?: string
  ): () => void {
    const channelName = `active_restrictions_${tournamentId || 'all'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const filter = tournamentId ? `tournament_id=eq.${tournamentId}` : undefined;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_user_restrictions',
          ...(filter ? { filter } : {}),
        },
        () => {
          onRestrictionChange();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`Realtime channel error for active restrictions`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

