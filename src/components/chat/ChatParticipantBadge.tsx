import React from 'react';
import { ChatParticipantIdentity } from '../../types/chat';
import { Shield, ShieldAlert, Award, User, Building2, Flag } from 'lucide-react';

interface ChatParticipantBadgeProps {
  identity?: ChatParticipantIdentity | null;
  fallbackName?: string | null;
  fallbackRoles?: string[] | null;
  isMine?: boolean;
  size?: 'sm' | 'md';
}

export const ChatParticipantBadge: React.FC<ChatParticipantBadgeProps> = ({
  identity,
  fallbackName,
  fallbackRoles,
  isMine = false,
  size = 'md',
}) => {
  const name = identity?.fullName || fallbackName || (isMine ? 'You' : 'Unknown User');
  const canonicalRole = identity?.canonicalRole || (fallbackRoles && fallbackRoles[0]) || 'No Role';
  const roleBadge = identity?.roleBadge || canonicalRole;
  const affiliationLabel = identity?.affiliationLabel || 'No Team/Club';
  const isOfficial = identity?.isOfficial || false;

  // Visual styling mapped to canonical roles
  const getRoleStyle = (role: string) => {
    switch (role.toUpperCase()) {
      case 'SUPER_ADMIN':
      case 'SUPER ADMIN':
        return 'bg-amber-950/90 text-amber-300 border-amber-500/60 shadow-amber-950/40';
      case 'ADMIN':
        return 'bg-indigo-950/90 text-indigo-300 border-indigo-500/60 shadow-indigo-950/40';
      case 'ORGANIZER':
        return 'bg-purple-950/90 text-purple-300 border-purple-500/60 shadow-purple-950/40';
      case 'REFEREE':
      case 'TECHNICAL_OFFICIAL':
      case 'TECHNICAL OFFICIAL':
      case 'TABLE_OFFICIAL':
      case 'TABLE OFFICIAL':
      case 'MEDICAL_OFFICIAL':
      case 'MEDICAL OFFICIAL':
        return 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 shadow-emerald-950/40';
      case 'COACH':
        return 'bg-sky-950/90 text-sky-300 border-sky-500/60 shadow-sky-950/40';
      case 'ATHLETE':
        return 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60 shadow-cyan-950/40';
      case 'USER':
        return 'bg-slate-800/90 text-slate-300 border-slate-700 shadow-slate-950/40';
      case 'NO ROLE':
      default:
        return 'bg-slate-900/90 text-slate-400 border-slate-800 shadow-none';
    }
  };

  const isCompact = size === 'sm';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
      {/* Participant Full Name */}
      <span className={`font-semibold text-slate-200 truncate ${isCompact ? 'text-[11px] max-w-[130px]' : 'text-xs max-w-[160px]'}`}>
        {name}
      </span>

      {/* Canonical Role Badge */}
      <span
        className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md font-mono font-bold tracking-wider uppercase border shadow-sm ${
          isCompact ? 'text-[8px]' : 'text-[9px]'
        } ${getRoleStyle(canonicalRole)}`}
      >
        {(canonicalRole === 'SUPER_ADMIN' || canonicalRole === 'ADMIN') && (
          <Shield className="w-2.5 h-2.5 mr-0.5 text-amber-400 shrink-0" />
        )}
        {isOfficial && !['SUPER_ADMIN', 'ADMIN'].includes(canonicalRole) && (
          <Award className="w-2.5 h-2.5 mr-0.5 text-emerald-400 shrink-0" />
        )}
        <span>{roleBadge}</span>
      </span>

      {/* Affiliation / Team / Club Badge */}
      {affiliationLabel && affiliationLabel !== 'No Team/Club' ? (
        <span
          className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md font-medium text-slate-300 bg-slate-950/80 border border-slate-800 truncate ${
            isCompact ? 'text-[8px] max-w-[140px]' : 'text-[9px] max-w-[180px]'
          }`}
          title={affiliationLabel}
        >
          {isOfficial ? (
            <Flag className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
          ) : (
            <Building2 className="w-2.5 h-2.5 text-slate-400 shrink-0" />
          )}
          <span className="truncate">{affiliationLabel}</span>
        </span>
      ) : (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-medium text-slate-500 bg-slate-950/40 border border-slate-900/60 ${
            isCompact ? 'text-[8px]' : 'text-[9px]'
          }`}
        >
          No Team/Club
        </span>
      )}
    </div>
  );
};
