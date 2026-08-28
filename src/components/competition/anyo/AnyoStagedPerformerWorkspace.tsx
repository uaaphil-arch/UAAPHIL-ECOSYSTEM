import React from 'react';
import {
  Play,
  AlertCircle,
  Clock,
  UserX,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { AnyoPerformance } from '../../../types/tournament';

interface AnyoStagedPerformerWorkspaceProps {
  performance: AnyoPerformance;
  nextEligiblePerformance: AnyoPerformance | null;
  performingPerformance: AnyoPerformance | null;
  canCall: boolean;
  isReadOnly: boolean;
  onCallPerformer: (perfId: string) => void;
  onDqOrNoShow: (outcome: 'DQ' | 'NO_SHOW') => void;
  onNextCompetitor: () => void;
}

export const AnyoStagedPerformerWorkspace: React.FC<AnyoStagedPerformerWorkspaceProps> = ({
  performance,
  nextEligiblePerformance,
  performingPerformance,
  canCall,
  isReadOnly,
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
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
          <Clock className="w-8 h-8 animate-pulse" />
        </div>

        <div className="space-y-1">
          <div className="text-xs font-bold text-amber-400 uppercase tracking-widest">
            {performance.status === 'CALLED' ? 'Athlete Called to Court' : 'Competitor Staged in Queue'}
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
          {hasActivePerformer ? (
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
            <div className="p-3.5 bg-amber-950/40 border border-amber-700/60 rounded-xl text-xs text-amber-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Competitor is staged and ready. Click <strong>Call / Start Performing</strong> to dispatch athlete to the court and unlock live judge score cards.
              </span>
            </div>
          )}
        </div>

        {/* Action Button */}
        {canCall && !isReadOnly && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onCallPerformer(performance.id)}
              className="px-8 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all inline-flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Call / Start Performing</span>
            </button>
          </div>
        )}
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
