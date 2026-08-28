import React from 'react';
import { ChatUserRestriction } from '../../types/chat';
import { ShieldAlert, Lock, Clock, AlertTriangle } from 'lucide-react';

interface ChatComposerLockBannerProps {
  restriction: ChatUserRestriction;
  roomType?: string;
}

export const ChatComposerLockBanner: React.FC<ChatComposerLockBannerProps> = ({
  restriction,
  roomType,
}) => {
  const isPermanent = !restriction.expires_at;
  const expiresDate = restriction.expires_at ? new Date(restriction.expires_at) : null;
  const isExpired = expiresDate ? expiresDate.getTime() <= Date.now() : false;

  if (isExpired || !restriction.is_active) {
    return null;
  }

  const getScopeLabel = (scope: string) => {
    switch (scope) {
      case 'GLOBAL':
        return 'Global Forum Only';
      case 'TOURNAMENT':
        return 'This Tournament Channel';
      case 'ALL_CHAT':
        return 'All System Communications';
      default:
        return scope;
    }
  };

  const getRestrictionColor = (type: string) => {
    switch (type) {
      case 'BAN':
        return 'bg-rose-950/90 border-rose-800/90 text-rose-200';
      case 'MUTE':
        return 'bg-amber-950/90 border-amber-800/90 text-amber-200';
      case 'TIMEOUT':
        return 'bg-orange-950/90 border-orange-800/90 text-orange-200';
      default:
        return 'bg-rose-950/90 border-rose-800/90 text-rose-200';
    }
  };

  const getRestrictionBadge = (type: string) => {
    switch (type) {
      case 'BAN':
        return 'bg-rose-600 text-white';
      case 'MUTE':
        return 'bg-amber-600 text-slate-950';
      case 'TIMEOUT':
        return 'bg-orange-600 text-white';
      default:
        return 'bg-rose-600 text-white';
    }
  };

  return (
    <div
      className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg ${getRestrictionColor(
        restriction.restriction_type
      )}`}
    >
      <div className="flex items-start space-x-3">
        <div className="p-2 rounded-lg bg-black/40 border border-white/10 shrink-0 mt-0.5">
          <Lock className="w-5 h-5 text-rose-400" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold font-mono uppercase tracking-wider ${getRestrictionBadge(
                restriction.restriction_type
              )}`}
            >
              CHAT {restriction.restriction_type} ACTIVE
            </span>
            <span className="text-xs font-semibold text-white">
              Messaging Disabled: {getScopeLabel(restriction.scope)}
            </span>
          </div>
          <p className="text-xs text-slate-300">
            <span className="font-medium text-slate-400">Reason: </span>
            {restriction.reason || 'Violation of chat conduct policy.'}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 text-xs font-mono shrink-0 pl-11 sm:pl-0">
        <Clock className="w-4 h-4 text-slate-400" />
        <span className="text-slate-300">
          {isPermanent
            ? 'Permanent / Indefinite'
            : `Expires: ${expiresDate?.toLocaleDateString()} ${expiresDate?.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`}
        </span>
      </div>
    </div>
  );
};
