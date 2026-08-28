import React from 'react';
import {
  UserX,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { AnyoPerformance } from '../../../types/tournament';

interface AnyoTerminalStatusWorkspaceProps {
  performance: AnyoPerformance;
  onNextCompetitor: () => void;
}

export const AnyoTerminalStatusWorkspace: React.FC<AnyoTerminalStatusWorkspaceProps> = ({
  performance,
  onNextCompetitor,
}) => {
  const isDq = performance.status === 'DQ';

  return (
    <div className="space-y-6">
      <div className="bg-slate-950/80 border border-red-900/50 rounded-xl p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-red-950/40 border border-red-800/60 flex items-center justify-center mx-auto text-red-400">
          <UserX className="w-8 h-8" />
        </div>

        <div className="space-y-1">
          <div className="text-xs font-bold text-red-400 uppercase tracking-widest">
            {isDq ? 'Disqualified Performer (DQ)' : 'Recorded No-Show (NO SHOW)'}
          </div>
          <h4 className="text-xl font-bold text-slate-100">
            {performance.registration?.user_profile?.full_name} (#{performance.order_number})
          </h4>
          <p className="text-xs text-slate-400">
            {performance.registration?.team_name || 'Independent Team'}
          </p>
        </div>

        <div className="p-3.5 bg-red-950/30 border border-red-900/40 rounded-xl text-xs text-red-300 max-w-md mx-auto flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>
            This performance status is terminal and locked ({performance.status}). Scoring and marching sequence have moved forward.
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNextCompetitor}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-700"
        >
          <span>Next Competitor</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
