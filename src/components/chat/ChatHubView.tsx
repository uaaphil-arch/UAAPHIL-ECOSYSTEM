import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { chatService } from '../../services/chatService';
import { chatIdentityResolver } from '../../services/chatIdentityResolver';
import { tournamentService } from '../../services/tournamentService';
import {
  ChatRoom,
  ChatMessageWithSender,
  ChatUserRestriction,
  ChatParticipantIdentity,
} from '../../types/chat';
import { Tournament } from '../../types/tournament';
import { ChatParticipantBadge } from './ChatParticipantBadge';
import { ChatComposerLockBanner } from './ChatComposerLockBanner';
import { ChatModerationModal } from './ChatModerationModal';
import { ChatRestrictionsDrawer } from './ChatRestrictionsDrawer';
import { UserAvatar } from '../common/UserAvatar';
import {
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  ShieldBan,
  Archive,
  RefreshCw,
  AlertCircle,
  Clock,
  User,
  CheckCircle2,
  Trash2,
  Lock,
  Plus,
  Radio,
  Trophy,
  Globe,
  Info,
  X,
  SlidersHorizontal,
  MoreVertical,
} from 'lucide-react';

interface ChatHubViewProps {
  initialTournamentId?: string;
}

export const ChatHubView: React.FC<ChatHubViewProps> = ({ initialTournamentId }) => {
  const { user, profile, roles } = useAuth();

  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isAdmin = isSuperAdmin || roles.includes('ADMIN');
  const isOrganizerRole = roles.includes('ORGANIZER');

  // Rooms & selection
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Messages & realtime
  const [messages, setMessages] = useState<ChatMessageWithSender[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Authoritative Participant Identities (Batched Map)
  const [identities, setIdentities] = useState<Record<string, ChatParticipantIdentity>>({});

  // Current User Restriction State (Composer Lock)
  const [myRestriction, setMyRestriction] = useState<ChatUserRestriction | null>(null);
  const [isCheckingRestriction, setIsCheckingRestriction] = useState(false);

  // Moderation state (Message soft delete)
  const [modTargetMessage, setModTargetMessage] = useState<ChatMessageWithSender | null>(null);
  const [modReason, setModReason] = useState('Inappropriate or non-compliant content');
  const [isModerating, setIsModerating] = useState(false);

  // User Restriction Modal State
  const [restrictModalTarget, setRestrictModalTarget] = useState<{
    userId: string;
    userName: string;
    identity?: ChatParticipantIdentity | null;
  } | null>(null);

  // Active Restrictions Drawer
  const [isRestrictionsDrawerOpen, setIsRestrictionsDrawerOpen] = useState(false);
  const [activeRestrictionsCount, setActiveRestrictionsCount] = useState<number>(0);

  // Tournament creation modal state
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isCreateRoomModalOpen, setIsCreateRoomModalOpen] = useState(false);
  const [selectedTournamentForRoom, setSelectedTournamentForRoom] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const isCreatingRoomRef = useRef(false);

  // Global room creation state
  const [isInitializingGlobalRoom, setIsInitializingGlobalRoom] = useState(false);
  const isInitializingGlobalRoomRef = useRef(false);

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Load all accessible chat rooms (pure read-only discovery)
  const loadRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    setRoomError(null);
    try {
      const accessibleRooms = await chatService.fetchAccessibleRooms();
      setRooms(accessibleRooms);

      // Set active room
      if (accessibleRooms.length > 0) {
        setActiveRoomId((prev) => {
          if (prev && accessibleRooms.some((r) => r.id === prev)) return prev;
          if (initialTournamentId) {
            const match = accessibleRooms.find((r) => r.tournament_id === initialTournamentId);
            if (match) return match.id;
          }
          // Default to Global room or first room
          const globalRoom = accessibleRooms.find((r) => r.room_type === 'GLOBAL');
          return globalRoom ? globalRoom.id : accessibleRooms[0].id;
        });
      }
    } catch (err: unknown) {
      console.warn('Failed to load chat rooms:', err);
      setRoomError(err instanceof Error ? err.message : 'Unable to load chat rooms.');
    } finally {
      setIsLoadingRooms(false);
    }
  }, [initialTournamentId]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Load available tournaments for room creation (Admin/Organizer only)
  useEffect(() => {
    if (isAdmin || isOrganizerRole) {
      tournamentService
        .getTournaments()
        .then((data) => {
          const allTournaments = data || [];
          const eligibleTournaments = isAdmin
            ? allTournaments
            : allTournaments.filter((t) => t.organizer_id === user?.id);

          setTournaments(eligibleTournaments);
          if (eligibleTournaments.length > 0) {
            setSelectedTournamentForRoom(eligibleTournaments[0].id);
          } else {
            setSelectedTournamentForRoom('');
          }
        })
        .catch((err) => console.warn('Failed to load tournaments list for chat:', err));
    }
  }, [isAdmin, isOrganizerRole, user?.id]);

  // Active room object
  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null;

  // Determine if current user has moderator privileges on active room
  const canModerateActiveRoom = Boolean(
    activeRoom &&
      (isAdmin ||
        (isOrganizerRole &&
          activeRoom.room_type === 'TOURNAMENT' &&
          activeRoom.tournament_id &&
          tournaments.some((t) => t.id === activeRoom.tournament_id && t.organizer_id === user?.id)))
  );

  // Fetch active restrictions count for moderators
  const refreshRestrictionsCount = useCallback(async () => {
    if (isAdmin || isOrganizerRole) {
      try {
        const list = await chatService.fetchActiveRestrictions(
          isAdmin ? undefined : (activeRoom?.tournament_id || undefined)
        );
        setActiveRestrictionsCount(list.length);
      } catch (err) {
        console.warn('Failed to fetch active restrictions count:', err);
      }
    }
  }, [isAdmin, isOrganizerRole, activeRoom?.tournament_id]);

  useEffect(() => {
    refreshRestrictionsCount();
  }, [refreshRestrictionsCount]);

  // Check current user's restriction status in active room
  const checkMyRestrictions = useCallback(async () => {
    if (!activeRoomId || !user?.id) {
      setMyRestriction(null);
      return;
    }

    setIsCheckingRestriction(true);
    try {
      const res = await chatService.checkMyChatRestriction(activeRoomId);
      if (res.restricted && res.restriction) {
        setMyRestriction(res.restriction);
      } else {
        setMyRestriction(null);
      }
    } catch (err) {
      console.warn('Failed to check user chat restriction status:', err);
    } finally {
      setIsCheckingRestriction(false);
    }
  }, [activeRoomId, user?.id]);

  useEffect(() => {
    checkMyRestrictions();
  }, [checkMyRestrictions]);

  // Realtime subscription for current authenticated user's restriction events (instant lock/unlock)
  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = chatService.subscribeToUserRestrictions(user.id, () => {
      // Authoritatively re-verify database state upon any restriction event
      checkMyRestrictions();
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id, checkMyRestrictions]);

  // Realtime subscription for active restrictions (moderator counter & drawer sync)
  useEffect(() => {
    if (!isAdmin && !isOrganizerRole) return;

    const unsubscribe = chatService.subscribeToActiveRestrictions(
      () => {
        refreshRestrictionsCount();
      },
      isAdmin ? undefined : (activeRoom?.tournament_id || undefined)
    );

    return () => {
      unsubscribe();
    };
  }, [isAdmin, isOrganizerRole, activeRoom?.tournament_id, refreshRestrictionsCount]);

  // Handle automatic unlock when a TIMEOUT or temporary restriction expires
  useEffect(() => {
    if (!myRestriction || !myRestriction.expires_at) return;

    const expiryTime = new Date(myRestriction.expires_at).getTime();
    const now = Date.now();
    const delayMs = expiryTime - now;

    if (delayMs <= 0) {
      // Already expired, recheck immediately
      checkMyRestrictions();
      return;
    }

    // Schedule recheck at expiry with 500ms safety buffer
    const timerId = setTimeout(() => {
      checkMyRestrictions();
    }, delayMs + 500);

    return () => {
      clearTimeout(timerId);
    };
  }, [myRestriction, checkMyRestrictions]);

  // Revalidate restriction state on window focus / visibility change (multi-tab / sleep resume)
  useEffect(() => {
    const handleRevalidate = () => {
      if (document.visibilityState === 'visible') {
        checkMyRestrictions();
        if (isAdmin || isOrganizerRole) {
          refreshRestrictionsCount();
        }
      }
    };

    window.addEventListener('focus', handleRevalidate);
    document.addEventListener('visibilitychange', handleRevalidate);

    return () => {
      window.removeEventListener('focus', handleRevalidate);
      document.removeEventListener('visibilitychange', handleRevalidate);
    };
  }, [checkMyRestrictions, isAdmin, isOrganizerRole, refreshRestrictionsCount]);

  // Batched identity resolution helper
  const resolveMessageSenderIdentities = useCallback(
    async (msgs: ChatMessageWithSender[], tournamentId?: string | null) => {
      const senderIds = msgs.map((m) => m.sender_id).filter(Boolean);
      if (senderIds.length === 0) return;

      try {
        const resolved = await chatIdentityResolver.resolveIdentities(senderIds, tournamentId);
        setIdentities((prev) => ({ ...prev, ...resolved }));
      } catch (err) {
        console.warn('Failed to batch resolve sender identities:', err);
      }
    },
    []
  );

  // Load messages whenever activeRoomId changes
  const loadMessages = useCallback(
    async (roomId: string) => {
      if (!roomId) return;
      setIsLoadingMessages(true);
      setMessageError(null);
      try {
        const data = await chatService.fetchRoomMessages(roomId, 60);
        setMessages(data);

        // Resolve identities for all message senders in batch
        const targetRoom = rooms.find((r) => r.id === roomId);
        resolveMessageSenderIdentities(data, targetRoom?.tournament_id);

        // Mark read
        if (data.length > 0) {
          const lastMsg = data[data.length - 1];
          await chatService.updateMyReadState(roomId, lastMsg.id);
        } else {
          await chatService.updateMyReadState(roomId);
        }
        setTimeout(() => scrollToBottom(false), 50);
      } catch (err: unknown) {
        console.warn(`Failed to load messages for room ${roomId}:`, err);
        setMessageError(
          err instanceof Error ? err.message : 'Permission denied or unable to load messages.'
        );
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [rooms, resolveMessageSenderIdentities, scrollToBottom]
  );

  useEffect(() => {
    if (activeRoomId) {
      loadMessages(activeRoomId);
    } else {
      setMessages([]);
    }
  }, [activeRoomId, loadMessages]);

  // Realtime subscription for active room
  useEffect(() => {
    if (!activeRoomId) return;

    const unsubscribe = chatService.subscribeToRoomMessages(
      activeRoomId,
      (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) {
            return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
          }
          return [...prev, newMsg];
        });

        // Resolve new sender identity if not already present
        resolveMessageSenderIdentities([newMsg], activeRoom?.tournament_id);

        chatService.updateMyReadState(activeRoomId, newMsg.id);
        scrollToBottom(true);
      },
      (updatedMsg) => {
        setMessages((prev) => prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m)));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [activeRoomId, activeRoom?.tournament_id, resolveMessageSenderIdentities, scrollToBottom]);

  // Send message handler
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeRoomId || !inputText.trim() || isSending || myRestriction) return;

    const contentToSend = inputText.trim();
    if (contentToSend.length > 2000) return;

    if (activeRoom?.is_archived) {
      setMessageError('This room is archived. New messages cannot be sent.');
      return;
    }

    setIsSending(true);
    setMessageError(null);
    try {
      const sent = await chatService.sendMessage({
        room_id: activeRoomId,
        content: contentToSend,
      });
      setInputText('');
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });
      scrollToBottom(true);
    } catch (err: unknown) {
      console.error('Send message error:', err);
      // If error indicates restriction, refresh restriction state
      if (err instanceof Error && err.message.toLowerCase().includes('restricted')) {
        checkMyRestrictions();
      }
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  // Moderator soft-delete action
  const handleConfirmModeration = async () => {
    if (!modTargetMessage || !activeRoomId || isModerating) return;

    setIsModerating(true);
    try {
      await chatService.softDeleteMessage({
        message_id: modTargetMessage.id,
        room_id: activeRoomId,
        reason: modReason.trim(),
      });
      // Optimistic update in UI
      setMessages((prev) =>
        prev.map((m) =>
          m.id === modTargetMessage.id
            ? {
                ...m,
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                deleted_by: user?.id || null,
                deleted_reason: modReason.trim(),
              }
            : m
        )
      );
      setModTargetMessage(null);
    } catch (err: unknown) {
      console.error('Moderation error:', err);
      alert(err instanceof Error ? err.message : 'Failed to moderate message.');
    } finally {
      setIsModerating(false);
    }
  };

  // Toggle archive action
  const handleToggleArchive = async () => {
    if (!activeRoom || !canModerateActiveRoom) return;

    const actionText = activeRoom.is_archived ? 'unarchive' : 'archive';
    if (!window.confirm(`Are you sure you want to ${actionText} this chat room?`)) {
      return;
    }

    try {
      await chatService.toggleRoomArchived(activeRoom.id, !activeRoom.is_archived);
      await loadRooms();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update room archive status.');
    }
  };

  // Initialize global room handler (Admins only)
  const handleInitializeGlobalRoom = async () => {
    if (isInitializingGlobalRoom || isInitializingGlobalRoomRef.current) return;
    if (!isAdmin) {
      alert('Unauthorized: Only administrators can initialize the global chat room.');
      return;
    }

    isInitializingGlobalRoomRef.current = true;
    setIsInitializingGlobalRoom(true);
    try {
      const newRoom = await chatService.createGlobalRoom();
      await loadRooms();
      if (newRoom?.id) {
        setActiveRoomId(newRoom.id);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to initialize global chat room.');
    } finally {
      isInitializingGlobalRoomRef.current = false;
      setIsInitializingGlobalRoom(false);
    }
  };

  // Create tournament room handler
  const handleCreateTournamentRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTournamentForRoom || isCreatingRoom || isCreatingRoomRef.current) return;

    const targetTournament = tournaments.find((t) => t.id === selectedTournamentForRoom);
    if (!targetTournament) {
      alert('Please select a valid tournament.');
      return;
    }

    if (!isAdmin && targetTournament.organizer_id !== user?.id) {
      alert('Unauthorized: You can only initialize chat rooms for tournaments you own.');
      return;
    }

    isCreatingRoomRef.current = true;
    setIsCreatingRoom(true);
    try {
      const newRoom = await chatService.createTournamentRoom({
        tournament_id: selectedTournamentForRoom,
      });
      setIsCreateRoomModalOpen(false);
      await loadRooms();
      setActiveRoomId(newRoom.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create tournament chat room.');
    } finally {
      isCreatingRoomRef.current = false;
      setIsCreatingRoom(false);
    }
  };

  const hasGlobalRoom = rooms.some((r) => r.room_type === 'GLOBAL');

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-9.5rem)] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100vh-8.5rem)] min-h-0 lg:min-h-[500px] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* LEFT: Room Selector Sidebar */}
      <div className="w-full lg:w-80 bg-slate-950/80 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col shrink-0">
        {/* Sidebar Header */}
        <div className="p-2.5 sm:p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-white tracking-tight">Channels &amp; Chats</h2>
              <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono">Live Realtime Forum</span>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={loadRooms}
              disabled={isLoadingRooms}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
              title="Refresh rooms"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRooms ? 'animate-spin text-amber-400' : ''}`} />
            </button>

            {(isAdmin || isOrganizerRole) && (
              <>
                <button
                  type="button"
                  onClick={() => setIsRestrictionsDrawerOpen(true)}
                  className="relative p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-700 transition"
                  title="Manage Active Chat Restrictions"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {activeRestrictionsCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold font-mono flex items-center justify-center shadow">
                      {activeRestrictionsCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateRoomModalOpen(true)}
                  className="p-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition"
                  title="Create Tournament Chat"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Global Chat Initialization Banner for Admins */}
        {!hasGlobalRoom && isAdmin && (
          <div className="mx-2 mt-2 p-2 sm:mx-2.5 sm:mt-2.5 sm:p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 text-sky-200 text-xs space-y-1.5 sm:space-y-2">
            <div className="flex items-center space-x-2 text-sky-400 font-bold">
              <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Official Global Forum</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 leading-tight">
              No official global channel exists yet. One official channel is allowed system-wide for all delegates.
            </p>
            <button
              type="button"
              onClick={handleInitializeGlobalRoom}
              disabled={isInitializingGlobalRoom}
              className="w-full py-1 sm:py-1.5 px-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-[11px] sm:text-xs transition flex items-center justify-center space-x-1.5 disabled:opacity-50 shadow-md shadow-sky-950/50"
            >
              {isInitializingGlobalRoom ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Initialize Official UAAPHIL Global Chat</span>
            </button>
          </div>
        )}

        {/* Room List */}
        <div className="flex-1 overflow-y-auto p-1.5 sm:p-2.5 space-y-1 sm:space-y-1.5 max-h-24 sm:max-h-32 lg:max-h-none">
          {isLoadingRooms && rooms.length === 0 ? (
            <div className="py-4 sm:py-8 text-center text-xs text-slate-500 flex flex-col items-center space-y-2">
              <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
              <span>Loading authorized rooms...</span>
            </div>
          ) : rooms.length === 0 ? (
            <div className="py-4 sm:py-8 text-center text-xs text-slate-500 p-3 sm:p-4 space-y-2">
              <Info className="w-5 h-5 sm:w-6 sm:h-6 mx-auto text-slate-600" />
              <p>No chat channels accessible to your account.</p>
            </div>
          ) : (
            rooms.map((r) => {
              const isActive = r.id === activeRoomId;
              const isGlobal = r.room_type === 'GLOBAL';

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveRoomId(r.id)}
                  className={`w-full text-left p-2 sm:p-3 rounded-xl border transition-all flex items-start space-x-2 sm:space-x-2.5 ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500/40 text-white shadow-md'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <div
                    className={`mt-0.5 p-1.5 sm:p-2 rounded-lg shrink-0 ${
                      isGlobal
                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {isGlobal ? <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate">{r.title}</span>
                      {r.is_archived && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-slate-400 truncate mt-0.5">
                      {isGlobal
                        ? 'Open communication forum for all delegates'
                        : r.tournament_name || r.description || 'Tournament Channel'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* User Presence Badge */}
        {user && (
          <div className="px-3 py-1.5 sm:p-3 border-t border-slate-800 bg-slate-950/60 flex items-center space-x-2 sm:space-x-2.5 text-xs">
            <UserAvatar
              avatarUrl={profile?.avatar_url}
              name={profile?.full_name || user.email}
              role={isSuperAdmin ? 'SUPER ADMIN' : roles[0] || 'USER'}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-200 truncate text-[11px] sm:text-xs">
                {profile?.full_name || user.email}
              </div>
              <div className="text-[9px] sm:text-[10px] text-slate-400 font-mono flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                <span className="text-emerald-400">Connected</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Active Chat Room Timeline & Compose Box */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-900/60">
        {/* Room Header */}
        {activeRoom ? (
          <div className="px-3.5 sm:px-5 py-2.5 sm:py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
              <div
                className={`p-1.5 sm:p-2 rounded-xl shrink-0 ${
                  activeRoom.room_type === 'GLOBAL'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}
              >
                {activeRoom.room_type === 'GLOBAL' ? (
                  <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {activeRoom.title}
                  </h3>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-mono font-bold uppercase ${
                      activeRoom.room_type === 'GLOBAL'
                        ? 'bg-sky-950 text-sky-300 border border-sky-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}
                  >
                    {activeRoom.room_type}
                  </span>
                  {activeRoom.is_archived && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-mono bg-rose-950 text-rose-300 border border-rose-800">
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  {activeRoom.description || 'Live tournament communication channel.'}
                </p>
              </div>
            </div>

            {/* Room Actions */}
            <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
              {canModerateActiveRoom && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsRestrictionsDrawerOpen(true)}
                    className="flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-950/60 text-rose-300 border border-rose-800 hover:bg-rose-900 transition"
                    title="View & Revoke Active Restrictions"
                  >
                    <ShieldBan className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Restrictions</span>
                    {activeRestrictionsCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[9px] font-mono font-bold">
                        {activeRestrictionsCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleArchive}
                    className={`flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                      activeRoom.is_archived
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800 hover:bg-emerald-900'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                    }`}
                    title={activeRoom.is_archived ? 'Unarchive room' : 'Archive room'}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{activeRoom.is_archived ? 'Unarchive' : 'Archive'}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => activeRoomId && loadMessages(activeRoomId)}
                disabled={isLoadingMessages}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
                title="Refresh messages"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMessages ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-slate-800 text-xs text-slate-400">
            Select a chat room to begin messaging.
          </div>
        )}

        {/* Message Error Banner */}
        {messageError && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{messageError}</span>
            </div>
            <button
              type="button"
              onClick={() => setMessageError(null)}
              className="text-rose-400 hover:text-rose-200 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Archived Notice */}
        {activeRoom?.is_archived && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-300 text-xs flex items-center space-x-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>This chat channel has been archived. It remains available for review in read-only mode.</span>
          </div>
        )}

        {/* Message Timeline */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4 min-h-0"
        >
          {isLoadingMessages && messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
              <span className="text-xs">Loading secure message timeline...</span>
            </div>
          ) : !activeRoom ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                <Globe className="w-6 h-6 text-sky-400" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h4 className="text-sm font-semibold text-slate-300">
                  {!hasGlobalRoom && isAdmin ? 'Global Channel Not Initialized' : 'No Channel Selected'}
                </h4>
                <p className="text-xs text-slate-500">
                  {!hasGlobalRoom && isAdmin
                    ? 'Only one official global channel is permitted system-wide. Initialize the channel to enable delegate announcements.'
                    : 'Select a channel from the left sidebar to view messages and join discussions.'}
                </p>
              </div>
              {!hasGlobalRoom && isAdmin && (
                <button
                  type="button"
                  onClick={handleInitializeGlobalRoom}
                  disabled={isInitializingGlobalRoom}
                  className="py-2 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition flex items-center space-x-1.5 disabled:opacity-50 shadow-lg shadow-sky-950/40"
                >
                  {isInitializingGlobalRoom ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Initialize Official UAAPHIL Global Chat</span>
                </button>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-300">No Messages Yet</h4>
              <p className="text-xs text-slate-500 max-w-xs">
                Be the first to post a message in this channel. Communications are recorded with live timestamps.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = user?.id === msg.sender_id;
              const senderIdentity = identities[msg.sender_id] || null;

              // Format timestamp
              const formattedTime = new Date(msg.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const formattedDate = new Date(msg.created_at).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={msg.id}
                  className={`group flex items-start space-x-3 ${isMine ? 'flex-row-reverse space-x-reverse' : ''}`}
                >
                  {/* Sender Avatar */}
                  <UserAvatar
                    avatarUrl={senderIdentity?.avatarUrl}
                    name={senderIdentity?.fullName || msg.sender?.full_name}
                    role={senderIdentity?.canonicalRole || msg.sender_roles?.[0]}
                    size="md"
                  />

                  {/* Message Bubble Container */}
                  <div className={`max-w-[85%] sm:max-w-[75%] space-y-1 ${isMine ? 'text-right' : 'text-left'}`}>
                    {/* Sender Identity & Role Badge */}
                    <div className={`flex items-center space-x-2 text-[11px] ${isMine ? 'justify-end' : 'justify-start'} flex-wrap gap-y-0.5`}>
                      <ChatParticipantBadge
                        identity={senderIdentity}
                        fallbackName={msg.sender?.full_name}
                        fallbackRoles={msg.sender_roles}
                        isMine={isMine}
                        size="md"
                      />
                      <span className="text-slate-500 text-[10px] font-mono">
                        {formattedDate} {formattedTime}
                      </span>
                    </div>

                    {/* Content Box */}
                    <div
                      className={`relative p-3.5 rounded-2xl text-xs leading-relaxed break-words shadow-md ${
                        msg.is_deleted
                          ? 'bg-slate-950/70 border border-rose-900/60 text-slate-400 italic'
                          : isMine
                          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-50'
                          : 'bg-slate-800/80 border border-slate-700/80 text-slate-100'
                      }`}
                    >
                      {msg.is_deleted ? (
                        <div className="flex items-center space-x-2 text-rose-300">
                          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>
                            [This message was removed by a moderator. Reason:{' '}
                            {msg.deleted_reason || 'Inappropriate content'}]
                          </span>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}

                      {/* Moderator Action Buttons (Visible on mobile/touch, hoverable on desktop) */}
                      {!msg.is_deleted && canModerateActiveRoom && (
                        <div
                          className={`absolute top-2 ${
                            isMine ? '-left-16' : '-right-16'
                          } opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity flex items-center space-x-1`}
                        >
                          {/* Restrict User Action */}
                          {!isMine && (
                            <button
                              type="button"
                              onClick={() => {
                                setRestrictModalTarget({
                                  userId: msg.sender_id,
                                  userName:
                                    senderIdentity?.fullName ||
                                    msg.sender?.full_name ||
                                    'Participant',
                                  identity: senderIdentity,
                                });
                              }}
                              className="p-1 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800 transition shadow"
                              title="Restrict User (Ban / Mute / Timeout)"
                            >
                              <ShieldBan className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Soft Delete Action */}
                          <button
                            type="button"
                            onClick={() => {
                              setModTargetMessage(msg);
                              setModReason('Inappropriate or non-compliant content');
                            }}
                            className="p-1 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800 transition shadow"
                            title="Soft delete message"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Compose Box / Restricted Banner */}
        <div className="p-2.5 sm:p-4 border-t border-slate-800 bg-slate-950/80 space-y-2 shrink-0">
          {/* Active Restriction Composer Lock Banner */}
          {myRestriction ? (
            <ChatComposerLockBanner
              restriction={myRestriction}
              roomType={activeRoom?.room_type}
            />
          ) : (
            <form onSubmit={handleSendMessage} className="space-y-2">
              <div className="relative flex items-center">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={isSending || !activeRoom || Boolean(activeRoom?.is_archived)}
                  placeholder={
                    !activeRoom
                      ? 'Select a channel to write a message...'
                      : activeRoom?.is_archived
                      ? 'This channel is archived and read-only.'
                      : 'Write a message... (Press Enter to send, Shift+Enter for new line)'
                  }
                  rows={2}
                  maxLength={2000}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 pr-24 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/80 resize-none disabled:opacity-50 transition"
                />

                <div className="absolute right-2.5 bottom-2.5 flex items-center space-x-2">
                  <span className="text-[10px] font-mono text-slate-500">
                    {inputText.length}/2000
                  </span>
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isSending || !activeRoom || Boolean(activeRoom?.is_archived)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Message Soft-Delete Moderation Modal */}
      {modTargetMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-sm font-bold text-white">Moderate Message</h3>
              </div>
              <button
                type="button"
                onClick={() => setModTargetMessage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Soft-deleting this message will remove its content from public view and record required moderation metadata in the audit trail.
            </p>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 italic max-h-24 overflow-y-auto">
              "{modTargetMessage.content}"
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Reason for Removal</label>
              <select
                value={modReason}
                onChange={(e) => setModReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
              >
                <option value="Inappropriate or non-compliant content">Inappropriate or non-compliant content</option>
                <option value="Spam or unsolicited advertising">Spam or unsolicited advertising</option>
                <option value="Disrespectful or unsportsmanlike conduct">Disrespectful or unsportsmanlike conduct</option>
                <option value="Off-topic or irrelevant discussion">Off-topic or irrelevant discussion</option>
                <option value="Disciplinary tournament official intervention">Disciplinary tournament official intervention</option>
              </select>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setModTargetMessage(null)}
                disabled={isModerating}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmModeration}
                disabled={isModerating}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-950/40 flex items-center space-x-1.5"
              >
                {isModerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Remove Message</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Restriction Modal (Ban / Mute / Timeout) */}
      {restrictModalTarget && (
        <ChatModerationModal
          targetUserId={restrictModalTarget.userId}
          targetUserName={restrictModalTarget.userName}
          targetIdentity={restrictModalTarget.identity}
          currentRoomId={activeRoomId}
          currentRoomType={activeRoom?.room_type || null}
          currentTournamentId={activeRoom?.tournament_id || null}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
          isOrganizer={isOrganizerRole}
          onClose={() => setRestrictModalTarget(null)}
          onSuccess={() => {
            refreshRestrictionsCount();
            if (activeRoomId) {
              loadMessages(activeRoomId);
            }
          }}
        />
      )}

      {/* Active Restrictions Management Drawer */}
      <ChatRestrictionsDrawer
        isOpen={isRestrictionsDrawerOpen}
        onClose={() => setIsRestrictionsDrawerOpen(false)}
        tournamentId={activeRoom?.tournament_id || null}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        isOrganizer={isOrganizerRole}
        onRestrictionRevoked={() => {
          refreshRestrictionsCount();
          checkMyRestrictions();
        }}
        onRestrictionCreated={() => {
          refreshRestrictionsCount();
          if (activeRoomId) {
            loadMessages(activeRoomId);
          }
        }}
      />

      {/* Create Tournament Room Modal */}
      {isCreateRoomModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-400">
                <Trophy className="w-5 h-5" />
                <h3 className="text-sm font-bold text-white">Initialize Tournament Chat</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateRoomModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Create a dedicated communication channel for an existing tournament. Only tournament officials and participating coaches will have access.
            </p>

            {tournaments.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-white">No Eligible Tournaments Found</p>
                  <p className="text-slate-300">
                    {isAdmin
                      ? 'No tournaments exist in the system yet. Please create a tournament first before initializing its chat channel.'
                      : 'You do not own any tournaments currently available to initialize a chat channel.'}
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateTournamentRoom} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Select Tournament</label>
                  <select
                    value={selectedTournamentForRoom}
                    onChange={(e) => setSelectedTournamentForRoom(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {tournaments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateRoomModalOpen(false)}
                    disabled={isCreatingRoom}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingRoom || !selectedTournamentForRoom}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shadow-lg shadow-amber-950/40 flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingRoom ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Create Channel</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
