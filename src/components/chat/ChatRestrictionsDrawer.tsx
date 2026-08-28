import React, { useState, useEffect, useCallback } from 'react';
import { chatService } from '../../services/chatService';
import { ChatUserRestriction } from '../../types/chat';
import { ChatModerationModal } from './ChatModerationModal';
import {
  ShieldAlert,
  ShieldBan,
  VolumeX,
  Hourglass,
  X,
  RefreshCw,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  Undo2,
  Search,
  Filter,
} from 'lucide-react';

interface ChatRestrictionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId?: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isOrganizer?: boolean;
  onRestrictionRevoked?: () => void;
  onRestrictionCreated?: () => void;
}

export const ChatRestrictionsDrawer: React.FC<ChatRestrictionsDrawerProps> = ({
  isOpen,
  onClose,
  tournamentId,
  isAdmin,
  isSuperAdmin,
  isOrganizer,
  onRestrictionRevoked,
  onRestrictionCreated,
}) => {
  const [restrictions, setRestrictions] = useState<ChatUserRestriction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');

  const canModerate = isSuperAdmin || isAdmin || Boolean(isOrganizer);

  // Direct Participant Restriction Modal State
  const [isDirectRestrictOpen, setIsDirectRestrictOpen] = useState<boolean>(false);
  const [directTargetUserId, setDirectTargetUserId] = useState<string>('');
  const [directTargetUserName, setDirectTargetUserName] = useState<string>('');
  const [directInputError, setDirectInputError] = useState<string | null>(null);
  const [moderationModalTarget, setModerationModalTarget] = useState<{
    userId: string;
    userName: string;
  } | null>(null);

  // Revocation Modal State
  const [revokingTarget, setRevokingTarget] = useState<ChatUserRestriction | null>(null);
  const [revocationReason, setRevocationReason] = useState<string>(
    'Penalty term served / appeal approved'
  );
  const [isRevoking, setIsRevoking] = useState<boolean>(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadRestrictions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Admins can see all active restrictions; Organizers see tournament-scoped restrictions
      const data = await chatService.fetchActiveRestrictions(
        isAdmin
          ? undefined
          : tournamentId
            ? { tournamentId }
            : undefined
      );
      setRestrictions(data);
    } catch (err: unknown) {
      console.error('Error fetching restrictions:', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load active restrictions.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, tournamentId]);

  useEffect(() => {
    if (isOpen) {
      loadRestrictions();

      const unsubscribe = chatService.subscribeToActiveRestrictions(
        () => {
          loadRestrictions();
        },
        isAdmin ? undefined : (tournamentId || undefined)
      );

      return () => {
        unsubscribe();
      };
    }
  }, [isOpen, isAdmin, tournamentId, loadRestrictions]);

  const handleConfirmRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingTarget) return;

    const trimmedReason = revocationReason.trim();
    if (!trimmedReason) {
      setRevokeError('A valid revocation reason is required for the audit log.');
      return;
    }

    setIsRevoking(true);
    setRevokeError(null);
    try {
      await chatService.revokeRestriction({
        restriction_id: revokingTarget.id,
        revocation_reason: trimmedReason,
      });

      // Update local state
      setRestrictions((prev) => prev.filter((r) => r.id !== revokingTarget.id));
      setRevokingTarget(null);
      if (onRestrictionRevoked) {
        onRestrictionRevoked();
      }
    } catch (err: unknown) {
      console.error('Error revoking restriction:', err);
      setRevokeError(
        err instanceof Error ? err.message : 'Failed to revoke restriction. Verify permissions.'
      );
    } finally {
      setIsRevoking(false);
    }
  };

  if (!isOpen) return null;

  const filteredRestrictions = restrictions.filter((r) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    return (
      (r.user_name && r.user_name.toLowerCase().includes(term)) ||
      r.user_id.toLowerCase().includes(term) ||
      r.reason.toLowerCase().includes(term) ||
      r.restriction_type.toLowerCase().includes(term) ||
      r.scope.toLowerCase().includes(term)
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      {/* Dedicated Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Content Drawer */}
      <div className="relative w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl z-10 flex flex-col h-full overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white tracking-tight truncate">
                Active Chat Governance &amp; Restrictions
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Authoritative moderation records • Real-time revocation
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {canModerate && (
              <button
                type="button"
                onClick={() => {
                  setIsDirectRestrictOpen(true);
                  setDirectTargetUserId('');
                  setDirectTargetUserName('');
                  setDirectInputError(null);
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-sm flex items-center space-x-1.5"
                title="Restrict a participant by user ID / UUID"
              >
                <ShieldBan className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Restrict Participant</span>
                <span className="sm:hidden">Restrict</span>
              </button>
            )}
            <button
              type="button"
              onClick={loadRestrictions}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
              title="Refresh restrictions"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search & Stats Bar */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by participant name, UUID, reason, or scope..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="text-xs text-slate-400 font-mono">
            <span className="text-amber-400 font-bold">{filteredRestrictions.length}</span> Active Restrictions
          </div>
        </div>

        {/* Error Notice (Top Banner if error occurred during reload) */}
        {errorMessage && (
          <div className="m-4 p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center justify-between space-x-2">
            <div className="flex items-center space-x-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="truncate">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={loadRestrictions}
              className="px-2.5 py-1 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 text-[11px] font-semibold shrink-0 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Restrictions List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && restrictions.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-2 text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
              <span className="text-xs">Loading active restrictions...</span>
            </div>
          ) : errorMessage && restrictions.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-center p-6 bg-rose-950/20 border border-rose-900/50 rounded-2xl">
              <AlertTriangle className="w-10 h-10 text-rose-400" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-rose-200">Unable to load active restrictions</h4>
                <p className="text-xs text-rose-300/80 max-w-sm">{errorMessage}</p>
              </div>
              <button
                type="button"
                onClick={loadRestrictions}
                className="px-4 py-2 rounded-xl bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-700 text-xs font-semibold transition flex items-center space-x-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Loading</span>
              </button>
            </div>
          ) : restrictions.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-500 text-center p-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-500/80" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-300">No Active Restrictions Found</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  All participants currently have active sending privileges without active bans, mutes, or timeouts.
                </p>
              </div>
            </div>
          ) : filteredRestrictions.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-500 text-center p-6">
              <Search className="w-10 h-10 text-slate-600" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-300">No restrictions match your search</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  No active restrictions match &ldquo;<span className="text-amber-400 font-mono">{searchFilter}</span>&rdquo;.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Clear Search Filter
              </button>
            </div>
          ) : (
            filteredRestrictions.map((r) => {
              const isPermanent = !r.expires_at;
              const expiresDate = r.expires_at ? new Date(r.expires_at) : null;
              const restrictedDate = new Date(r.restricted_at);

              return (
                <div
                  key={r.id}
                  className="p-4 bg-slate-950/80 border border-slate-800/90 rounded-2xl space-y-3 shadow-md hover:border-slate-700 transition"
                >
                  {/* Top Row: User + Badges */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white">
                          {r.user_name || 'Restricted Participant'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${
                            r.restriction_type === 'BAN'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : r.restriction_type === 'MUTE'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-orange-950 text-orange-300 border border-orange-800'
                          }`}
                        >
                          {r.restriction_type}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                          SCOPE: {r.scope}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        User ID: {r.user_id}
                      </div>
                    </div>

                    {/* Revoke Action Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setRevokingTarget(r);
                        setRevocationReason('Penalty term served / appeal approved');
                        setRevokeError(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 text-slate-300 border border-slate-700 hover:border-emerald-800 text-xs font-semibold transition flex items-center space-x-1.5 shadow-sm"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Revoke</span>
                    </button>
                  </div>

                  {/* Reason Text */}
                  <div className="p-2.5 bg-slate-900/90 rounded-xl border border-slate-800/80 text-xs text-slate-300">
                    <span className="font-semibold text-slate-400">Reason: </span>
                    {r.reason}
                  </div>

                  {/* Metadata Footer */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-900 flex-wrap gap-2">
                    <div className="flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Applied {restrictedDate.toLocaleDateString()} {restrictedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {r.restricted_by_name ? ` by ${r.restricted_by_name}` : ''}
                      </span>
                    </div>
                    <div className="text-amber-400/90 font-bold">
                      {isPermanent
                        ? 'Permanent / Indefinite'
                        : `Expires: ${expiresDate?.toLocaleDateString()} ${expiresDate?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Direct Participant Selection Modal */}
      {isDirectRestrictOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-rose-400">
                <ShieldBan className="w-5 h-5" />
                <h4 className="text-sm font-bold text-white">Identify Participant to Restrict</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsDirectRestrictOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Specify the target participant&apos;s User UUID to configure a Ban, Mute, or Timeout restriction.
            </p>

            {directInputError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{directInputError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmedId = directTargetUserId.trim();
                if (!trimmedId) {
                  setDirectInputError('A valid Participant User UUID / ID is required.');
                  return;
                }
                setDirectInputError(null);
                setModerationModalTarget({
                  userId: trimmedId,
                  userName: directTargetUserName.trim() || 'Participant',
                });
                setIsDirectRestrictOpen(false);
              }}
              className="space-y-3 text-xs"
            >
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">
                  Target User UUID / ID <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={directTargetUserId}
                  onChange={(e) => setDirectTargetUserId(e.target.value)}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">
                  Participant Display Name / Alias <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={directTargetUserName}
                  onChange={(e) => setDirectTargetUserName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz / Team Captain"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDirectRestrictOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!directTargetUserId.trim()}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-950/50 flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Configure Restriction</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Moderation Modal for Direct Restriction */}
      {moderationModalTarget && (
        <ChatModerationModal
          targetUserId={moderationModalTarget.userId}
          targetUserName={moderationModalTarget.userName}
          currentTournamentId={tournamentId || null}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
          isOrganizer={Boolean(isOrganizer)}
          onClose={() => setModerationModalTarget(null)}
          onSuccess={() => {
            setModerationModalTarget(null);
            loadRestrictions();
            if (onRestrictionCreated) {
              onRestrictionCreated();
            }
          }}
        />
      )}

      {/* Revocation Confirmation Modal */}
      {revokingTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-emerald-400">
                <Undo2 className="w-5 h-5" />
                <h4 className="text-sm font-bold text-white">Revoke Chat Restriction</h4>
              </div>
              <button
                type="button"
                onClick={() => setRevokingTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Revoking this restriction will immediately restore chat participation rights for{' '}
              <strong className="text-white">
                {revokingTarget.user_name || revokingTarget.user_id}
              </strong>
              . This action is permanently recorded in the system audit trail.
            </p>

            {revokeError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{revokeError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmRevoke} className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">
                  Revocation Reason / Justification
                </label>
                <input
                  type="text"
                  value={revocationReason}
                  onChange={(e) => setRevocationReason(e.target.value)}
                  placeholder="e.g. Penalty term served / appeal approved / mistakenly applied..."
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRevokingTarget(null)}
                  disabled={isRevoking}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRevoking || !revocationReason.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-950/50 flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isRevoking ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="w-3.5 h-3.5" />
                  )}
                  <span>Confirm Revocation</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
