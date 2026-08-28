import React from 'react';
import {
  CheckCircle2,
  Trophy,
  UserX,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { AnyoPerformance, AnyoScore } from '../../../types/tournament';

interface AnyoCompletedPerformerWorkspaceProps {
  performance: AnyoPerformance;
  score: AnyoScore | null;
  tier2Score: AnyoScore | null;
  calcMethod: string;
  panelCount: number;
  isReadOnly: boolean;
  isFinalized: boolean;
  onDqOrNoShow: (outcome: 'DQ' | 'NO_SHOW') => void;
  onNextCompetitor: () => void;
}

export const AnyoCompletedPerformerWorkspace: React.FC<AnyoCompletedPerformerWorkspaceProps> = ({
  performance,
  score,
  tier2Score,
  calcMethod,
  panelCount,
  isReadOnly,
  isFinalized,
  onDqOrNoShow,
  onNextCompetitor,
}) => {
  const displayScore = tier2Score || score;
  const rawMarks = displayScore?.judge_scores || [];
  const sortedMarks = [...rawMarks].sort((a, b) => a - b);
  const isOlympic = calcMethod === 'OLYMPIC_TRIM' && sortedMarks.length >= 3;
  const minTrimmed = isOlympic ? sortedMarks[0] : null;
  const maxTrimmed = isOlympic ? sortedMarks[sortedMarks.length - 1] : null;

  return (
    <div className="space-y-6">
      {/* Certified Result Summary Card */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Official Recorded Performance
            </div>
            <h4 className="text-xl font-bold text-slate-100">
              {performance.registration?.user_profile?.full_name} (#{performance.order_number})
            </h4>
            <p className="text-xs text-slate-400">
              {performance.registration?.team_name || 'Independent'}
            </p>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-4 text-center sm:text-right shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300 block">
              Certified Score
            </span>
            <span className="text-3xl font-black font-mono text-amber-300">
              {performance.final_score?.toFixed(2) ?? '—'}
              <span className="text-xs text-slate-400 font-sans font-normal ml-1">pts</span>
            </span>
          </div>
        </div>

        {/* Individual Judge Marks Breakdown */}
        {rawMarks.length > 0 ? (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Judge Score Breakdown ({rawMarks.length} Judges • {calcMethod.replace('_', ' ')})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-7 gap-2">
              {rawMarks.map((val, idx) => {
                const isMin = isOlympic && val === minTrimmed;
                const isMax = isOlympic && val === maxTrimmed;
                const isDropped = isMin || isMax;

                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border text-center space-y-1 ${
                      isDropped
                        ? 'bg-slate-950 border-slate-800 opacity-60'
                        : 'bg-slate-900 border-slate-700 shadow-sm'
                    }`}
                  >
                    <div className="text-[10px] font-bold text-slate-400">
                      Judge {idx + 1}
                    </div>
                    <div className={`text-sm font-mono font-bold ${isDropped ? 'line-through text-slate-500' : 'text-amber-300'}`}>
                      {val.toFixed(1)}
                    </div>
                    {isDropped && (
                      <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-tight block">
                        {isMin ? 'Min Trim' : 'Max Trim'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic text-center py-4">
            Detailed judge score card is archived. Final certified score is recorded above.
          </div>
        )}

        {/* Tier 2 Re-Score Pill */}
        {tier2Score && (
          <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-300 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Includes <strong>Tier 2 Re-Performance</strong> score ({tier2Score.calculated_score?.toFixed(2)} pts) recorded for tie-break resolution.
            </span>
          </div>
        )}
      </div>

      {/* Retroactive Adjudication Box */}
      {!isReadOnly && !isFinalized && (
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Administrative Adjudication:</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDqOrNoShow('DQ')}
              className="px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
            >
              <UserX className="w-3.5 h-3.5" />
              <span>Retroactive DQ</span>
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
