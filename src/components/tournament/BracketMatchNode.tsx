import React from 'react';
import {
  Trophy,
  Activity,
  CheckCircle2,
  Clock,
  Shield,
  ExternalLink,
} from 'lucide-react';
import { BracketNode } from '../../types/brackets';

interface BracketMatchNodeProps {
  node: BracketNode;
  canManage?: boolean;
  onOpenCourtOperations?: (matchId: string) => void;
}

export const BracketMatchNode: React.FC<BracketMatchNodeProps> = ({
  node,
  canManage,
  onOpenCourtOperations,
}) => {
  const {
    match_number,
    round_name,
    court_identifier,
    status,
    red_participant,
    blue_participant,
    winner_corner,
    is_bye_node,
    is_live,
    is_completed,
  } = node;

  return (
    <div
      className={`relative w-72 rounded-xl border transition-all duration-200 shadow-md ${
        is_live
          ? 'bg-slate-900/95 border-amber-500 shadow-amber-500/20 ring-2 ring-amber-500/40'
          : is_completed
          ? 'bg-slate-900/80 border-slate-700/80'
          : is_bye_node
          ? 'bg-slate-950/60 border-slate-800/60 opacity-85'
          : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Card Header: Match #, Round, Court & Status */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/80 bg-slate-950/50 rounded-t-xl text-[11px]">
        <div className="flex items-center gap-1.5 font-medium text-slate-300">
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold text-[10px]">
            M{match_number}
          </span>
          <span className="truncate max-w-[100px] text-slate-400">{round_name}</span>
        </div>

        <div className="flex items-center gap-1">
          {court_identifier && court_identifier !== 'BYE' && (
            <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800/60 text-[9px] font-bold">
              {court_identifier}
            </span>
          )}

          {is_live && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-black animate-pulse">
              <Activity className="w-2.5 h-2.5" />
              LIVE
            </span>
          )}
          {is_completed && !is_bye_node && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 text-[9px] font-bold">
              <CheckCircle2 className="w-2.5 h-2.5" />
              FINAL
            </span>
          )}
          {is_bye_node && (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-bold">
              BYE
            </span>
          )}
          {!is_live && !is_completed && !is_bye_node && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 text-[9px]">
              <Clock className="w-2.5 h-2.5" />
              WAITING
            </span>
          )}
        </div>
      </div>

      {/* Participants Container */}
      <div className="p-2 space-y-1.5 text-xs">
        {/* Red Corner Participant */}
        <div
          className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
            winner_corner === 'RED'
              ? 'bg-rose-950/40 border border-rose-600/60 text-white font-bold'
              : winner_corner === 'BLUE'
              ? 'bg-slate-950/40 border border-transparent text-slate-500 opacity-60'
              : red_participant.is_bye
              ? 'bg-slate-950/30 border border-dashed border-slate-800 text-slate-500'
              : 'bg-slate-950/50 border border-slate-800/60 text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="w-2 h-6 rounded-sm bg-rose-600 shrink-0 shadow-sm" />
            <div className="min-w-0">
              <div className="truncate font-semibold flex items-center gap-1">
                <span className="truncate">{red_participant.athlete_name}</span>
                {winner_corner === 'RED' && (
                  <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-amber-400" />
                )}
              </div>
              {red_participant.club_or_school && (
                <div className="text-[10px] text-slate-400 truncate">
                  {red_participant.club_or_school}
                </div>
              )}
            </div>
          </div>
          <span className="text-[10px] font-black text-rose-400 shrink-0 px-1 py-0.5 rounded bg-rose-950/80">
            RED
          </span>
        </div>

        {/* Blue Corner Participant */}
        <div
          className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
            winner_corner === 'BLUE'
              ? 'bg-blue-950/40 border border-blue-600/60 text-white font-bold'
              : winner_corner === 'RED'
              ? 'bg-slate-950/40 border border-transparent text-slate-500 opacity-60'
              : blue_participant.is_bye
              ? 'bg-slate-950/30 border border-dashed border-slate-800 text-slate-500'
              : 'bg-slate-950/50 border border-slate-800/60 text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="w-2 h-6 rounded-sm bg-blue-600 shrink-0 shadow-sm" />
            <div className="min-w-0">
              <div className="truncate font-semibold flex items-center gap-1">
                <span className="truncate">{blue_participant.athlete_name}</span>
                {winner_corner === 'BLUE' && (
                  <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-amber-400" />
                )}
              </div>
              {blue_participant.club_or_school && (
                <div className="text-[10px] text-slate-400 truncate">
                  {blue_participant.club_or_school}
                </div>
              )}
            </div>
          </div>
          <span className="text-[10px] font-black text-blue-400 shrink-0 px-1 py-0.5 rounded bg-blue-950/80">
            BLUE
          </span>
        </div>
      </div>

      {/* Footer / Ops Trigger */}
      {canManage && onOpenCourtOperations && !is_bye_node && (
        <div className="px-2 pb-2 pt-0.5 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenCourtOperations(node.match_id)}
            className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors px-2 py-1 rounded bg-amber-950/40 hover:bg-amber-950/70 border border-amber-900/60"
            title="Open match in Court Operations"
          >
            <span>Court Ops</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
    </div>
  );
};
