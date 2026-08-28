import React, { useState } from 'react';
import { chatService } from '../../services/chatService';
import {
  ChatRestrictionType,
  ChatRestrictionScope,
  ChatParticipantIdentity,
} from '../../types/chat';
import {
  ShieldAlert,
  X,
  AlertTriangle,
  Clock,
  Globe,
  Trophy,
  ShieldBan,
  VolumeX,
  Hourglass,
  RefreshCw,
} from 'lucide-react';

interface ChatModerationModalProps {
  targetUserId: string;
  targetUserName?: string;
  targetIdentity?: ChatParticipantIdentity | null;
  currentRoomId?: string | null;
  currentRoomType?: 'GLOBAL' | 'TOURNAMENT' | null;
  currentTournamentId?: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_REASONS = [
  'Inappropriate or abusive language',
  'Spam or unsolicited promotional links',
  'Harassment or unsportsmanlike conduct',
  'Disruption of official tournament communications',
  'Impersonation of UAAPHIL officials',
  'Violation of platform community rules',
];

export const ChatModerationModal: React.FC<ChatModerationModalProps> = ({
  targetUserId,
  targetUserName,
  targetIdentity,
  currentRoomId,
  currentRoomType,
  currentTournamentId,
  isSuperAdmin,
  isAdmin,
  isOrganizer,
  onClose,
  onSuccess,
}) => {
  const isGlobalAdmin = isSuperAdmin || isAdmin;

  // Form State
  const [restrictionType, setRestrictionType] = useState<ChatRestrictionType>('TIMEOUT');
  const [scope, setScope] = useState<ChatRestrictionScope>(() => {
    if (!isGlobalAdmin && isOrganizer) return 'TOURNAMENT';
    if (currentRoomType === 'GLOBAL') return 'GLOBAL';
    if (currentRoomType === 'TOURNAMENT') return 'TOURNAMENT';
    return 'ALL_CHAT';
  });

  // Duration in minutes (null = permanent)
  const [durationMinutes, setDurationMinutes] = useState<number | null>(60);
  const [reason, setReason] = useState<string>('Inappropriate or abusive language');
  const [customReason, setCustomReason] = useState<string>('');
  const [useCustomReason, setUseCustomReason] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const displayName =
    targetIdentity?.fullName || targetUserName || 'Selected Participant';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const finalReason = useCustomReason ? customReason.trim() : reason.trim();
    if (!finalReason) {
      setErrorMessage('A valid reason is required for applying a chat restriction.');
      return;
    }

    if (scope === 'TOURNAMENT' && !currentTournamentId) {
      setErrorMessage('Tournament ID is required for tournament-scoped restrictions.');
      return;
    }

    setIsSubmitting(true);
    try {
      await chatService.restrictUser({
        target_user_id: targetUserId,
        restriction_type: restrictionType,
        scope,
        tournament_id: scope === 'TOURNAMENT' ? currentTournamentId : null,
        reason: finalReason,
        duration_minutes: durationMinutes,
      });

      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error('Failed to apply chat restriction:', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to apply restriction. Verify moderator permissions.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5 text-rose-400">
            <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-800/80">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Apply Chat Restriction</h3>
              <p className="text-[11px] text-slate-400">Authoritative Moderator Action</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target Identity Summary */}
        <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800/90 space-y-1.5 text-xs">
          <div className="text-[11px] text-slate-400 font-medium">Target Participant:</div>
          <div className="flex items-center space-x-2 flex-wrap">
            <span className="font-bold text-white text-sm">{displayName}</span>
            {targetIdentity?.canonicalRole && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-slate-800 text-amber-300 border border-slate-700">
                {targetIdentity.roleBadge}
              </span>
            )}
            {targetIdentity?.affiliationLabel && (
              <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-800">
                {targetIdentity.affiliationLabel}
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate">
            UUID: {targetUserId}
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* 1. Restriction Type */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-200">Action Type</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRestrictionType('TIMEOUT')}
                className={`p-2.5 rounded-xl border flex flex-col items-center space-y-1 text-center transition ${
                  restrictionType === 'TIMEOUT'
                    ? 'bg-orange-500/20 border-orange-500 text-orange-200 font-bold shadow-md shadow-orange-950/50'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Hourglass className="w-4 h-4" />
                <span className="text-xs">TIMEOUT</span>
                <span className="text-[10px] text-slate-400">Temporary lock</span>
              </button>

              <button
                type="button"
                onClick={() => setRestrictionType('MUTE')}
                className={`p-2.5 rounded-xl border flex flex-col items-center space-y-1 text-center transition ${
                  restrictionType === 'MUTE'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-bold shadow-md shadow-amber-950/50'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <VolumeX className="w-4 h-4" />
                <span className="text-xs">MUTE</span>
                <span className="text-[10px] text-slate-400">Silent / Read-only</span>
              </button>

              <button
                type="button"
                onClick={() => setRestrictionType('BAN')}
                className={`p-2.5 rounded-xl border flex flex-col items-center space-y-1 text-center transition ${
                  restrictionType === 'BAN'
                    ? 'bg-rose-500/20 border-rose-500 text-rose-200 font-bold shadow-md shadow-rose-950/50'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ShieldBan className="w-4 h-4" />
                <span className="text-xs">BAN</span>
                <span className="text-[10px] text-slate-400">Strict expulsion</span>
              </button>
            </div>
          </div>

          {/* 2. Scope */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-200">Enforcement Scope</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScope('GLOBAL')}
                disabled={!isGlobalAdmin}
                className={`p-2 rounded-xl border text-left flex items-center space-x-2 transition ${
                  scope === 'GLOBAL'
                    ? 'bg-sky-500/20 border-sky-500 text-sky-200 font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">Global Chat</div>
                  <div className="text-[9px] text-slate-400 truncate">Admins only</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setScope('TOURNAMENT')}
                className={`p-2 rounded-xl border text-left flex items-center space-x-2 transition ${
                  scope === 'TOURNAMENT'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Trophy className="w-3.5 h-3.5 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">Tournament</div>
                  <div className="text-[9px] text-slate-400 truncate">Scoped room</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setScope('ALL_CHAT')}
                disabled={!isGlobalAdmin}
                className={`p-2 rounded-xl border text-left flex items-center space-x-2 transition ${
                  scope === 'ALL_CHAT'
                    ? 'bg-purple-500/20 border-purple-500 text-purple-200 font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">All Chats</div>
                  <div className="text-[9px] text-slate-400 truncate">Entire platform</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. Duration Presets */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-200 flex items-center justify-between">
              <span>Duration</span>
              <span className="text-[10px] text-slate-400 font-normal font-mono">
                {durationMinutes === null
                  ? 'Permanent / Indefinite'
                  : durationMinutes < 60
                  ? `${durationMinutes} Minutes`
                  : durationMinutes < 1440
                  ? `${durationMinutes / 60} Hours`
                  : `${durationMinutes / 1440} Days`}
              </span>
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 font-mono text-[11px]">
              {[
                { label: '5m', mins: 5 },
                { label: '15m', mins: 15 },
                { label: '1h', mins: 60 },
                { label: '24h', mins: 1440 },
                { label: '7d', mins: 10080 },
                { label: 'Indefinite', mins: null },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setDurationMinutes(item.mins)}
                  className={`py-1.5 px-2 rounded-lg border text-center transition ${
                    durationMinutes === item.mins
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Reason */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-200">Reason for Restriction</label>
            {!useCustomReason ? (
              <div className="space-y-2">
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
                >
                  {PRESET_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setUseCustomReason(true)}
                  className="text-[11px] text-amber-400 hover:underline inline-block"
                >
                  + Specify custom reason
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Enter detailed reason for audit trail..."
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <button
                  type="button"
                  onClick={() => setUseCustomReason(false)}
                  className="text-[11px] text-slate-400 hover:underline inline-block"
                >
                  Back to preset reasons
                </button>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-950/50 flex items-center space-x-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
              <span>Confirm Restriction</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
