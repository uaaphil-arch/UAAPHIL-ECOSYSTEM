import React from 'react';
import {
  Sparkles,
  UserX,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Lock,
} from 'lucide-react';
import { AnyoTieTier } from '../../../types/tournament';

interface AnyoActivePerformerWorkspaceProps {
  panelCount: number;
  judgeInputs: number[];
  scoreGroups: { label: string; scores: number[] }[];
  scorePreview: {
    sorted: number[];
    minTrimmed: number | null;
    maxTrimmed: number | null;
    trimmedScores: number[];
    score: number;
  } | null;
  allJudgesEntered: boolean;
  isSubmitting: boolean;
  isReadOnly: boolean;
  activeTier: AnyoTieTier;
  calcMethod: string;
  onScoreSelect: (judgeIndex: number, scoreValue: number) => void;
  onSubmitScores: () => void;
  onDqOrNoShow: (outcome: 'DQ' | 'NO_SHOW') => void;
  onNextCompetitor: () => void;
}

export const AnyoActivePerformerWorkspace: React.FC<AnyoActivePerformerWorkspaceProps> = ({
  panelCount,
  judgeInputs,
  scoreGroups,
  scorePreview,
  allJudgesEntered,
  isSubmitting,
  isReadOnly,
  activeTier,
  calcMethod,
  onScoreSelect,
  onSubmitScores,
  onDqOrNoShow,
  onNextCompetitor,
}) => {
  return (
    <div className="space-y-6">
      {/* Judge Input Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-emerald-400 uppercase tracking-wider">
              LIVE JUDGE SCORING
            </span>
            <span className="text-slate-500">•</span>
            <span className="font-semibold uppercase tracking-wider">
              Judge Score Cards ({panelCount} Judges)
            </span>
          </div>
          <span className="text-amber-400/90 font-medium">
            Standard Scale: 7.0 – 10.0 (in 0.1 increments)
          </span>
        </div>

        <div className="space-y-4">
          {Array.from({ length: panelCount }).map((_, idx) => {
            const currentVal = judgeInputs[idx] || 0;
            const isEntered = currentVal >= 7.0 && currentVal <= 10.0;
            return (
              <div
                key={idx}
                className={`bg-slate-950/90 border rounded-xl p-3.5 space-y-2.5 transition-colors ${
                  isEntered ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800'
                }`}
              >
                {/* Judge Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                      J{idx + 1}
                    </span>
                    <span className="text-xs font-bold text-slate-200">
                      Judge {idx + 1}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isEntered ? (
                      <span className="px-3 py-1 bg-amber-400 text-slate-950 rounded-lg text-xs font-black font-mono shadow-sm">
                        {currentVal.toFixed(1)}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded-md text-[11px] font-semibold">
                        Pending
                      </span>
                    )}
                  </div>
                </div>

                {/* Decimal Selector Matrix */}
                <div className="space-y-1.5 pt-1">
                  {scoreGroups.map((group) => (
                    <div key={group.label} className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-500 w-12 shrink-0">
                        {group.label.replace(' Tier', '')}
                      </span>
                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 w-full">
                        {group.scores.map((score) => {
                          const isSelected = currentVal === score;
                          return (
                            <button
                              key={score}
                              type="button"
                              onClick={() => onScoreSelect(idx, score)}
                              disabled={isReadOnly}
                              className={`h-9 sm:h-10 rounded-lg text-xs font-mono font-bold transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed ${
                                isSelected
                                  ? 'bg-amber-400 text-slate-950 font-black scale-105 shadow-md shadow-amber-500/20 ring-2 ring-amber-300 z-10'
                                  : 'bg-slate-900/90 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-600 hover:text-white'
                              }`}
                            >
                              {score.toFixed(1)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Authoritative Live Preview Calculation Banner */}
      {scorePreview && (
        <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
          <div className="space-y-1 text-center sm:text-left">
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center justify-center sm:justify-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Calculated Preview ({calcMethod.replace('_', ' ')})
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {calcMethod === 'OLYMPIC_TRIM' ? (
                <>
                  Sorted: [{scorePreview.sorted.map((s) => s.toFixed(1)).join(', ')}] • Dropped: Low ({scorePreview.minTrimmed?.toFixed(1)}), High ({scorePreview.maxTrimmed?.toFixed(1)})
                </>
              ) : (
                <>
                  All marks: [{scorePreview.sorted.map((s) => s.toFixed(1)).join(', ')}]
                </>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-xs text-slate-400 font-semibold mr-2">Estimated:</span>
            <span className="text-lg font-black text-amber-300 font-mono">
              {scorePreview.score.toFixed(2)} pts
            </span>
          </div>
        </div>
      )}

      {/* Console Action Bar */}
      <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onDqOrNoShow('DQ')}
            disabled={isReadOnly}
            className="px-3 py-2.5 bg-red-950/60 hover:bg-red-900/80 border border-red-800 disabled:opacity-30 disabled:cursor-not-allowed text-red-300 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1"
          >
            <UserX className="w-4 h-4" />
            DQ
          </button>

          <button
            type="button"
            onClick={() => onDqOrNoShow('NO_SHOW')}
            disabled={isReadOnly}
            className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 text-xs font-semibold rounded-xl transition-colors"
          >
            No Show
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={onSubmitScores}
            disabled={isReadOnly || !allJudgesEntered || isSubmitting}
            className="flex-1 sm:flex-initial px-6 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-sm font-black rounded-xl transition-all shadow-lg shadow-emerald-950/60 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Calculating...</span>
              </>
            ) : isReadOnly ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Read-Only Mode</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Submit {activeTier === 'TIER_2' ? 'Tie-Break Re-Performance' : 'Standard Initial'} Score</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onNextCompetitor}
            className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-700"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
