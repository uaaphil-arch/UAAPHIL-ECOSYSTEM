import React from 'react';
import { CourtOperationsMetrics } from '../../types/courtOperations';
import { Swords, ShieldAlert, CheckCircle2, Clock, Activity, LayoutGrid } from 'lucide-react';

interface QueueIntelligenceStatsProps {
  metrics: CourtOperationsMetrics;
}

export const QueueIntelligenceStats: React.FC<QueueIntelligenceStatsProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
      {/* Live Matches */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Live Matches</p>
          <p className="text-2xl font-black text-amber-600 mt-0.5">{metrics.liveMatchesCount}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600">
          <Activity className="w-5 h-5 animate-pulse" />
        </div>
      </div>

      {/* Courts Utilization */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Utilization</p>
          <p className="text-2xl font-black text-indigo-600 mt-0.5">{metrics.courtUtilizationPercentage}%</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600">
          <LayoutGrid className="w-5 h-5" />
        </div>
      </div>

      {/* Ready Queue */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ready to Assign</p>
          <p className="text-2xl font-black text-emerald-600 mt-0.5">{metrics.readyQueueCount}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-600">
          <Swords className="w-5 h-5" />
        </div>
      </div>

      {/* Assigned on Deck */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">On Deck / Queue</p>
          <p className="text-2xl font-black text-sky-600 mt-0.5">{metrics.assignedQueueCount}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200/60 flex items-center justify-center text-sky-600">
          <Clock className="w-5 h-5" />
        </div>
      </div>

      {/* Waiting / Blocked */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Awaiting Feeder</p>
          <p className="text-2xl font-black text-slate-600 mt-0.5">{metrics.waitingQueueCount}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
          <ShieldAlert className="w-5 h-5" />
        </div>
      </div>

      {/* Completed Matches */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-black text-slate-700 mt-0.5">{metrics.completedMatchesCount}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600">
          <CheckCircle2 className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
