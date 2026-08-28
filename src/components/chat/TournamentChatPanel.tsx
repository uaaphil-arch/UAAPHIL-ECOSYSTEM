import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { chatService } from '../../services/chatService';
import { chatIdentityResolver } from '../../services/chatIdentityResolver';
import {
  ChatRoom,
  ChatMessageWithSender,
  ChatUserRestriction,
  ChatParticipantIdentity,
} from '../../types/chat';
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
  Trophy,
  X,
  ExternalLink,
} from 'lucide-react';

interface TournamentChatPanelProps {
  tournamentId: string;
  tournamentName?: string;
  organizerId?: string;
  isOrganizerOrAdmin?: boolean;
}

export const TournamentChatPanel: React.FC<TournamentChatPanelProps> = ({
  tournamentId,
  tournamentName = 'Tournament',
  organizerId: propOrganizerId,
  isOrganizerOrAdmin = false,
}) => {
  const { user, profile, roles } = useAuth();

  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isAdmin = isSuperAdmin || roles.includes('ADMIN');
  const isOrganizerRole = roles.includes('ORGANIZER');

  const [resolvedOrganizerId, setResolvedOrganizerId] = useState<string | null>(propOrganizerId || null);

  // Sync propOrganizerId if provided
  useEffect(() => {
    if (propOrganizerId) {
      setResolvedOrganizerId(propOrganizerId);
    }
  }, [propOrganizerId]);

  // If propOrganizerId not provided and user is an organizer, fetch tournament to check organizer_id
  useEffect(() => {
    if (!propOrganizerId && tournamentId && isOrganizerRole && !isAdmin) {
      const fetchOrganizer = async () => {
        try {
          const { data } = await supabase
            .from('tournaments')
            .select('organizer_id')
            .eq('id', tournamentId)
            .maybeSingle();

          if (data?.organizer_id) {
            setResolvedOrganizerId(data.organizer_id);
          }
        } catch (err) {
          console.warn('Failed to resolve tournament organizer:', err);
        }
      };

      fetchOrganizer();
    }
  }, [propOrganizerId, tournamentId, isOrganizerRole, isAdmin]);

  const isOwnerOrganizer = isOrganizerRole && Boolean(resolvedOrganizerId && user?.id && resolvedOrganizerId === user.id);
  const canModerate = isAdmin || isOwnerOrganizer;
  const canInitialize = isAdmin || isOwnerOrganizer;

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessageWithSender[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Authoritative Participant Identities (Batched Map)
  const [identities, setIdentities] = useState<Record<string, ChatParticipantIdentity>>({});

  // Current User Restriction State
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

  const [isInitializingRoom, setIsInitializingRoom] = useState(false);
  const isInitializingRoomRef = useRef(false);

  // Scroll ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Check current user restriction status
  const checkMyRestrictions = useCallback(async () => {
    if (!room?.id || !user?.id) {
      setMyRestriction(null);
      return;
    }

    setIsCheckingRestriction(true);
    try {
      const res = await chatService.checkMyChatRestriction(room.id);
      if (res.restricted && res.restriction) {
        setMyRestriction(res.restriction);
      } else {
        setMyRestriction(null);
      }
    } catch (err) {
      console.warn('Failed to check tournament chat restriction status:', err);
    } finally {
      setIsCheckingRestriction(false);
    }
  }, [room?.id, user?.id]);

  useEffect(() => {
    checkMyRestrictions();
  }, [checkMyRestrictions]);

  // Fetch active restrictions count
  const refreshRestrictionsCount = useCallback(async () => {
    if (canModerate && tournamentId) {
      try {
        const list = await chatService.fetchActiveRestrictions(
          isAdmin ? undefined : tournamentId
        );
        setActiveRestrictionsCount(list.length);
      } catch (err) {
        console.warn('Failed to fetch active restrictions count:', err);
      }
    }
  }, [canModerate, isAdmin, tournamentId]);

  useEffect(() => {
    refreshRestrictionsCount();
  }, [refreshRestrictionsCount]);

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

  // Realtime subscription for active tournament restrictions (moderator counter & drawer sync)
  useEffect(() => {
    if (!canModerate || !tournamentId) return;

    const unsubscribe = chatService.subscribeToActiveRestrictions(
      () => {
        refreshRestrictionsCount();
      },
      isAdmin ? undefined : tournamentId
    );

    return () => {
      unsubscribe();
    };
  }, [canModerate, isAdmin, tournamentId, refreshRestrictionsCount]);

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
        if (canModerate && tournamentId) {
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
  }, [checkMyRestrictions, canModerate, tournamentId, refreshRestrictionsCount]);

  // Batched sender identities resolver
  const resolveMessageSenderIdentities = useCallback(
    async (msgs: ChatMessageWithSender[]) => {
      const senderIds = msgs.map((m) => m.sender_id).filter(Boolean);
      if (senderIds.length === 0) return;

      try {
        const resolved = await chatIdentityResolver.resolveIdentities(senderIds, tournamentId);
        setIdentities((prev) => ({ ...prev, ...resolved }));
      } catch (err) {
        console.warn('Failed to batch resolve sender identities in tournament chat:', err);
      }
    },
    [tournamentId]
  );

  // Load tournament chat room
  const loadTournamentRoom = useCallback(async () => {
    if (!tournamentId) return;
    setIsLoadingRoom(true);
    setRoomError(null);
    try {
      const foundRoom = await chatService.fetchTournamentRoom(tournamentId);
      setRoom(foundRoom);
    } catch (err: unknown) {
      console.warn('Error fetching tournament room:', err);
      setRoomError(err instanceof Error ? err.message : 'Failed to fetch tournament room.');
    } finally {
      setIsLoadingRoom(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadTournamentRoom();
  }, [loadTournamentRoom]);

  // Load messages
  const loadMessages = useCallback(
    async (roomId: string) => {
      if (!roomId) return;
      setIsLoadingMessages(true);
      setMessageError(null);
      try {
        const data = await chatService.fetchRoomMessages(roomId, 50);
        setMessages(data);
        resolveMessageSenderIdentities(data);

        if (data.length > 0) {
          await chatService.updateMyReadState(roomId, data[data.length - 1].id);
        } else {
          await chatService.updateMyReadState(roomId);
        }
        setTimeout(() => scrollToBottom(false), 50);
      } catch (err: unknown) {
        console.warn('Error fetching room messages:', err);
        setMessageError(err instanceof Error ? err.message : 'Unable to load messages.');
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [resolveMessageSenderIdentities, scrollToBottom]
  );

  useEffect(() => {
    if (room?.id) {
      loadMessages(room.id);
    } else {
      setMessages([]);
    }
  }, [room?.id, loadMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!room?.id) return;

    const unsubscribe = chatService.subscribeToRoomMessages(
      room.id,
      (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) {
            return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
          }
          return [...prev, newMsg];
        });
        resolveMessageSenderIdentities([newMsg]);
        chatService.updateMyReadState(room.id, newMsg.id);
        scrollToBottom(true);
      },
      (updatedMsg) => {
        setMessages((prev) => prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m)));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [room?.id, resolveMessageSenderIdentities, scrollToBottom]);

  // Initialize room if missing
  const handleInitializeRoom = async () => {
    if (!tournamentId || isInitializingRoom || isInitializingRoomRef.current) return;

    if (!canInitialize) {
      alert('Unauthorized: You can only initialize chat rooms for tournaments you own.');
      return;
    }

    isInitializingRoomRef.current = true;
    setIsInitializingRoom(true);
    try {
      const newRoom = await chatService.createTournamentRoom({
        tournament_id: tournamentId,
        title: `${tournamentName} Official Chat`,
      });
      setRoom(newRoom);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to initialize tournament chat room.');
    } finally {
      isInitializingRoomRef.current = false;
      setIsInitializingRoom(false);
    }
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!room?.id || !inputText.trim() || isSending || myRestriction) return;

    const content = inputText.trim();
    if (content.length > 2000) return;

    if (room.is_archived) {
      setMessageError('This tournament chat channel is archived.');
      return;
    }

    setIsSending(true);
    setMessageError(null);
    try {
      const sent = await chatService.sendMessage({
        room_id: room.id,
        content,
      });
      setInputText('');
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });
      scrollToBottom(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.toLowerCase().includes('restricted')) {
        checkMyRestrictions();
      }
      setMessageError(err instanceof Error ? err.message : 'Failed to post message.');
    } finally {
      setIsSending(false);
    }
  };

  // Moderation
  const handleConfirmModeration = async () => {
    if (!modTargetMessage || !room?.id || isModerating) return;

    setIsModerating(true);
    try {
      await chatService.softDeleteMessage({
        message_id: modTargetMessage.id,
        room_id: room.id,
        reason: modReason.trim(),
      });
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
      alert(err instanceof Error ? err.message : 'Failed to moderate message.');
    } finally {
      setIsModerating(false);
    }
  };

  if (isLoadingRoom) {
    return (
      <div className="p-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center space-y-2 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
        <span className="text-xs">Checking tournament chat authorization...</span>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="p-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
          <Trophy className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-white">Tournament Chat Channel</h4>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            {canInitialize
              ? 'No dedicated chat channel has been activated for this tournament yet. Initialize the channel to enable direct communication with registered coaches and officials.'
              : 'The official chat channel for this tournament has not been activated yet.'}
          </p>
        </div>

        {canInitialize && (
          <button
            type="button"
            onClick={handleInitializeRoom}
            disabled={isInitializingRoom}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shadow flex items-center space-x-1.5"
          >
            {isInitializingRoom ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>Initialize Tournament Chat</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[580px] sm:h-[640px] max-h-[82dvh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white truncate">{room.title}</h4>
            <div className="flex items-center space-x-2 text-[9px] sm:text-[10px] text-slate-400">
              <span>Official Channel</span>
              <span>•</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Realtime
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {canModerate && (
            <button
              type="button"
              onClick={() => setIsRestrictionsDrawerOpen(true)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-700 transition relative"
              title="Manage Tournament Restrictions"
            >
              <ShieldBan className="w-3.5 h-3.5" />
              {activeRestrictionsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-600 text-white text-[8px] font-bold font-mono flex items-center justify-center">
                  {activeRestrictionsCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => loadMessages(room.id)}
            disabled={isLoadingMessages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            title="Refresh messages"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMessages ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Message Error Banner */}
      {messageError && (
        <div className="mx-3 mt-2 p-2 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{messageError}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessageError(null)}
            className="text-rose-400 hover:text-rose-200 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Message Timeline */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0 bg-slate-900/40">
        {isLoadingMessages && messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
            <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
            <span className="text-xs">Loading tournament chat...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
            <MessageSquare className="w-6 h-6 text-slate-600" />
            <span className="text-xs">No messages posted in this tournament chat yet.</span>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = user?.id === msg.sender_id;
            const senderIdentity = identities[msg.sender_id] || null;

            return (
              <div
                key={msg.id}
                className={`group flex items-start space-x-2.5 ${isMine ? 'flex-row-reverse space-x-reverse' : ''}`}
              >
                {/* Avatar */}
                <UserAvatar
                  avatarUrl={senderIdentity?.avatarUrl}
                  name={senderIdentity?.fullName || msg.sender?.full_name}
                  role={senderIdentity?.canonicalRole || msg.sender_roles?.[0]}
                  size="sm"
                />

                <div className={`max-w-[80%] space-y-0.5 ${isMine ? 'text-right' : 'text-left'}`}>
                  {/* Sender Badge */}
                  <div className={`flex items-center space-x-1.5 text-[10px] ${isMine ? 'justify-end' : 'justify-start'} flex-wrap gap-y-0.5`}>
                    <ChatParticipantBadge
                      identity={senderIdentity}
                      fallbackName={msg.sender?.full_name}
                      fallbackRoles={msg.sender_roles}
                      isMine={isMine}
                      size="sm"
                    />
                    <span className="text-slate-500 font-mono text-[9px]">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`relative p-2.5 rounded-xl text-xs leading-relaxed break-words shadow ${
                      msg.is_deleted
                        ? 'bg-slate-950/70 border border-rose-900/60 text-slate-400 italic'
                        : isMine
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-50'
                        : 'bg-slate-800/80 border border-slate-700 text-slate-100'
                    }`}
                  >
                    {msg.is_deleted ? (
                      <span className="text-rose-300 text-[11px]">
                        [Message removed by moderator: {msg.deleted_reason || 'Inappropriate content'}]
                      </span>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}

                    {/* Moderator action triggers */}
                    {!msg.is_deleted && canModerate && (
                      <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity ml-2 inline-flex items-center space-x-1">
                        {!isMine && (
                          <button
                            type="button"
                            onClick={() =>
                              setRestrictModalTarget({
                                userId: msg.sender_id,
                                userName:
                                  senderIdentity?.fullName ||
                                  msg.sender?.full_name ||
                                  'Participant',
                                identity: senderIdentity,
                              })
                            }
                            className="text-slate-400 hover:text-rose-300 p-0.5"
                            title="Restrict User"
                          >
                            <ShieldBan className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setModTargetMessage(msg)}
                          className="text-slate-400 hover:text-rose-300 p-0.5"
                          title="Moderate message"
                        >
                          <Trash2 className="w-3 h-3" />
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

      {/* Compose or Restricted Banner */}
      <div className="p-2.5 sm:p-3 bg-slate-950/90 border-t border-slate-800 space-y-2">
        {myRestriction ? (
          <ChatComposerLockBanner
            restriction={myRestriction}
            roomType="TOURNAMENT"
          />
        ) : (
          <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isSending || Boolean(room.is_archived)}
              placeholder="Type a message to tournament officials & coaches..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSending || Boolean(room.is_archived)}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </div>

      {/* Moderation Soft Delete Modal */}
      {modTargetMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-2xl">
            <h4 className="text-xs font-bold text-white flex items-center space-x-1.5 text-rose-400">
              <ShieldAlert className="w-4 h-4" />
              <span>Remove Message</span>
            </h4>
            <p className="text-[11px] text-slate-400">
              Provide a reason for removing this message from the tournament channel.
            </p>
            <input
              type="text"
              value={modReason}
              onChange={(e) => setModReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              placeholder="Reason for removal..."
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setModTargetMessage(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmModeration}
                disabled={isModerating}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                {isModerating ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Restriction Modal */}
      {restrictModalTarget && (
        <ChatModerationModal
          targetUserId={restrictModalTarget.userId}
          targetUserName={restrictModalTarget.userName}
          targetIdentity={restrictModalTarget.identity}
          currentRoomId={room.id}
          currentRoomType="TOURNAMENT"
          currentTournamentId={tournamentId}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
          isOrganizer={isOrganizerRole}
          onClose={() => setRestrictModalTarget(null)}
          onSuccess={() => {
            refreshRestrictionsCount();
            if (room.id) {
              loadMessages(room.id);
            }
          }}
        />
      )}

      {/* Active Restrictions Drawer */}
      <ChatRestrictionsDrawer
        isOpen={isRestrictionsDrawerOpen}
        onClose={() => setIsRestrictionsDrawerOpen(false)}
        tournamentId={tournamentId}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        isOrganizer={isOrganizerRole}
        onRestrictionRevoked={() => {
          refreshRestrictionsCount();
          checkMyRestrictions();
        }}
        onRestrictionCreated={() => {
          refreshRestrictionsCount();
          if (room.id) {
            loadMessages(room.id);
          }
        }}
      />
    </div>
  );
};
