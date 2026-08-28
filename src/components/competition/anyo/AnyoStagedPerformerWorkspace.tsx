import React from 'react';
import {
  Play,
  AlertCircle,
  Clock,
  UserX,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Lock,
  Loader2,
} from 'lucide-react';
import { AnyoPerformance } from '../../../types/tournament';

interface AnyoStagedPerformerWorkspaceProps {
  performance: AnyoPerformance;
  nextEligiblePerformance: AnyoPerformance | null;
  performingPerformance: AnyoPerformance | null;
  isCheckedIn: boolean;
  canCall: boolean;
  isCalling?: boolean;
  isReadOnly: boolean;
  panelCount?: number;
  scoreGroups?: { label: string; scores: number[] }[];
  onToggleCheckIn: (perfId: string) => void;
  onCallPerformer: (perfId: string) => void;
  onDqOrNoShow: (outcome: 'DQ' | 'NO_SHOW') => void;
  onNextCompetitor: () => void;
}

const DEFAULT_SCORE_GROUPS = [
  {
    label: '9.0+ Range',
    scores: [9.0, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0],
  },
  {
    label: '8.0 Range',
    scores: [8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9],
  },
  {
    label: '7.0 Range',
    scores: [7.0, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9],
  },
];

export const AnyoStagedPerformerWorkspace: React.FC<AnyoStagedPerformerWorkspaceProps> = ({
  performance,
  nextEligiblePerformance,
  performingPerformance,
  isCheckedIn,
  canCall,
  isCalling = false,
  isReadOnly,
  panelCount = 5,
  scoreGroups = DEFAULT_SCORE_GROUPS,
  onToggleCheckIn,
  onCallPerformer,
  onDqOrNoShow,
  onNextCompetitor,
}) => {
  const isNextEligible = performance.id === nextEligiblePerformance?.id;
  const hasActivePerformer = Boolean(
    performingPerformance && performingPerformance.id !== performance.id
  );

  return (
    <div className="space-y-6">
      {/* Staged Athlete Overview Card */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 text-center space-y-4">
        <div
          className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto transition-colors ${
            !isCheckedIn
              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
              : performance.status === 'CALLED'
              ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400'
              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
          }`}
        >
          {!isCheckedIn ? (
            <Clock className="w-8 h-8 animate-pulse" />
          ) : performance.status === 'CALLED' ? (
            <Play className="w-8 h-8 fill-current" />
          ) : (
            <CheckCircle2 className="w-8 h-8" />
          )}
        </div>

        <div className="space-y-1">
          <div
            className={`text-xs font-bold uppercase tracking-widest ${
              !isCheckedIn
                ? 'text-amber-400'
                : performance.status === 'CALLED'
                ? 'text-blue-400'
                : 'text-emerald-400'
            }`}
          >
            {!isCheckedIn
              ? 'NOT CHECKED IN • AWAITING MARSHALLING'
              : performance.status === 'CALLED'
              ? 'ATHLETE CALLED TO COURT'
              : 'CHECKED IN • READY'}
          </div>
          <h4 className="text-xl font-bold text-slate-100">
            {performance.registration?.user_profile?.full_name || 'Competitor'} (#{performance.order_number})
          </h4>
          <p className="text-xs text-slate-400">
            {performance.registration?.team_name || 'Independent Team'}
          </p>
        </div>

        {/* State Banner */}
        <div className="max-w-xl mx-auto">
          {!isCheckedIn ? (
            <div className="p-3.5 bg-amber-950/40 border border-amber-700/60 rounded-xl text-xs text-amber-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Athlete has not completed physical court check-in. The competitor must report to marshalling and be verified before entering the active staging queue and being dispatched to the mat.
              </span>
            </div>
          ) : performance.status === 'CALLED' ? (
            <div className="p-3.5 bg-blue-950/40 border border-blue-700/60 rounded-xl text-xs text-blue-200 flex items-center justify-center gap-2">
              <Play className="w-4 h-4 text-blue-400 shrink-0 fill-current" />
              <span>
                Athlete has been dispatched / called to the court. Live judge scoring will unlock when the performance begins on the mat.
              </span>
            </div>
          ) : hasActivePerformer ? (
            <div className="p-3.5 bg-purple-950/40 border border-purple-800/60 rounded-xl text-xs text-purple-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
              <span>
                Court is currently active for <strong>#{performingPerformance?.order_number} ({performingPerformance?.registration?.user_profile?.full_name})</strong>. Complete active competitor before calling staged competitors.
              </span>
            </div>
          ) : !isNextEligible ? (
            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                Sequential Marching Order: Competitor #{performance.order_number} cannot perform before earlier eligible competitor <strong>(#{nextEligiblePerformance?.order_number})</strong>.
              </span>
            </div>
          ) : (
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-700/60 rounded-xl text-xs text-emerald-200 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Competitor is physically checked in and ready for court dispatch. Click <strong>Call Athlete to Court</strong> to dispatch athlete to the mat.
              </span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {!isCheckedIn && performance.status === 'WAITING' && !isReadOnly && (
            <button
              type="button"
              onClick={() => onToggleCheckIn(performance.id)}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirm Physical Check-In</span>
            </button>
          )}

          {isCheckedIn && performance.status === 'CHECKED_IN' && canCall && !isReadOnly && (
            <button
              type="button"
              disabled={isCalling}
              onClick={() => onCallPerformer(performance.id)}
              className="px-8 py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-sm font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all inline-flex items-center gap-2"
            >
              {isCalling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Calling Athlete...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Call Athlete to Court</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Standby Judge Scorecard Interface (INV-ANYO-UI-STANDBY) */}
      <div className="space-y-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-400 shrink-0 mt-0.5 sm:mt-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-200 text-xs uppercase tracking-wider">
                  JUDGE SCORECARD
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 tracking-wider">
                  STATUS: STANDBY — SCORE ENTRY LOCKED
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {!isCheckedIn
                  ? 'Scorecard standby — athlete has not completed physical marshalling.'
                  : performance.status === 'CALLED'
                  ? 'Scorecard standby — athlete has been called to the court. Scoring unlocks when the performance starts.'
                  : 'Scorecard standby — athlete is checked in and ready for court dispatch.'}
              </p>
            </div>
          </div>

          <div className="text-right text-[11px] text-slate-500 font-mono shrink-0 pl-9 sm:pl-0">
            Panel: {panelCount} Judges • 7.0–10.0 scale
          </div>
        </div>

        {/* Standby Judge Cards Matrix */}
        <div className="space-y-3.5 opacity-60 select-none">
          {Array.from({ length: panelCount }).map((_, idx) => (
            <div
              key={idx}
              className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2.5"
            >
              {/* Judge Standby Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-xs font-bold text-slate-400">
                    J{idx + 1}
                  </span>
                  <span className="text-xs font-bold text-slate-400">
                    Judge {idx + 1}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded-md text-[11px] font-mono font-semibold">
                    [ — ]
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    Standby / Locked
                  </span>
                </div>
              </div>

              {/* Disabled Score Ranges Matrix */}
              <div className="space-y-1.5 pt-1">
                {scoreGroups.map((group) => (
                  <div key={group.label} className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-600 w-12 shrink-0">
                      {group.label.replace(' Tier', '')}
                    </span>
                    <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 w-full">
                      {group.scores.map((score) => (
                        <button
                          key={score}
                          type="button"
                          disabled
                          className="h-8 sm:h-9 rounded-lg text-xs font-mono font-bold bg-slate-900/40 border border-slate-800/50 text-slate-600 cursor-not-allowed disabled:opacity-40 flex items-center justify-center pointer-events-none"
                        >
                          {score.toFixed(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pre-Performance Administrative Actions */}
      {!isReadOnly && (
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Administrative Actions (Pre-Performance):</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDqOrNoShow('DQ')}
              className="px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
            >
              <UserX className="w-3.5 h-3.5" />
              <span>Pre-Performance DQ</span>
            </button>

            <button
              type="button"
              onClick={() => onDqOrNoShow('NO_SHOW')}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
            >
              Mark No-Show
            </button>

            <button
              type="button"
              onClick={onNextCompetitor}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 border border-slate-700"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
