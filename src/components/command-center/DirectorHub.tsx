import React from 'react';
import { Tournament, TournamentSnapshot } from '../../types/tournament';
import { CourtTelemetry, EnrichedQueueMatch, CourtOperationsMetrics } from '../../types/courtOperations';
import { OperationalStationId, OPERATIONAL_STATIONS_METADATA } from '../../types/commandCenter';
import {
  Crown,
  Layers,
  Award,
  Scale,
  Cpu,
  ShieldAlert,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  ArrowRight,
  ShieldCheck,
  Lock,
  Radio,
  FileText,
  Calendar,
  Users,
  Trophy,
} from 'lucide-react';

export interface DirectorHubProps {
  tournament: Tournament | null;
  snapshot: TournamentSnapshot | null;
  metrics: CourtOperationsMetrics | null;
  telemetry: CourtTelemetry[];
  queue: EnrichedQueueMatch[];
  lastSyncedAt: Date | null;
  onNavigateToStation: (stationId: OperationalStationId) => void;
  canManage: boolean;
}

export const DirectorHub: React.FC<DirectorHubProps> = ({
  tournament,
  snapshot,
  metrics,
  telemetry,
  queue,
  lastSyncedAt,
  onNavigateToStation,
  canManage,
}) => {
  if (!tournament) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
        <Crown className="w-10 h-10 text-amber-500/50 mx-auto" />
        <h3 className="text-lg font-bold text-white">No Tournament Selected</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Please select a tournament from the header selector to initialize the Director Hub governance console.
        </p>
      </div>
    );
  }

  // Calculate live ring breakdown
  const activeCourtsCount = telemetry.filter((c) => c.isActive).length;
  const liveCourtsCount = telemetry.filter((c) => c.isActive && c.state === 'LIVE').length;
  const readyCourtsCount = telemetry.filter((c) => c.isActive && c.state === 'ASSIGNED').length;
  const vacantCourtsCount = telemetry.filter((c) => c.isActive && c.state === 'AVAILABLE').length;
  const offlineCourtsCount = telemetry.filter((c) => !c.isActive).length;

  // Active bouts list for quick executive oversight
  const liveBouts = telemetry
    .filter((c) => c.isActive && c.activeMatch)
    .map((c) => ({
      courtName: c.courtName,
      match: c.activeMatch!,
    }));

  // Tournament Lifecycle Progress
  const totalMatches = (metrics?.totalCompletedMatches || 0) + queue.length + liveBouts.length;
  const completionPercentage = totalMatches > 0
    ? Math.round(((metrics?.completedMatchesCount || 0) / totalMatches) * 100)
    : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Executive Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-amber-950/20 border border-slate-800 rounded-xl sm:rounded-2xl p-3.5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1 sm:space-y-1.5">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="p-1 sm:p-1.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg shrink-0">
                <Crown className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
              <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight">
                {tournament.name}
              </h2>
              <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-mono font-bold shrink-0 ${
                tournament.status === 'ONGOING'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : tournament.status === 'COMPLETED'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}>
                {tournament.status}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 max-w-2xl leading-relaxed">
              Executive Tournament Director Command. Authoritative overview of live arena rings, active bouts, bracket progression, and shift safety.
            </p>
          </div>

          {/* Quick Dates & Snapshot Info */}
          <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-mono text-slate-300">
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center space-x-1.5 sm:space-x-2">
              <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
              <span>
                {new Date(tournament.start_date).toLocaleDateString()} – {new Date(tournament.end_date).toLocaleDateString()}
              </span>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center space-x-1.5 sm:space-x-2">
              <Lock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" />
              <span>
                {snapshot ? `Snapshot v${snapshot.version} (Active)` : 'Live Database Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Velocity / Bracket Completion Bar */}
        <div className="mt-4 sm:mt-6 pt-3.5 sm:pt-5 border-t border-slate-800/80 space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 flex items-center space-x-1.5 sm:space-x-2 text-[11px] sm:text-xs">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Tournament Bout Progression Velocity</span>
            </span>
            <span className="font-mono text-amber-400 font-bold text-[11px] sm:text-xs">
              {metrics?.completedMatchesCount || 0} / {totalMatches} Bouts ({completionPercentage}%)
            </span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-2 sm:h-2.5 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, completionPercentage))}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Operational Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Active Arena Rings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-lg space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
              Arena Rings
            </span>
            <span className="p-1.5 sm:p-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg sm:rounded-xl">
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-white font-mono">
            {activeCourtsCount} <span className="text-xs sm:text-sm font-normal text-slate-500">/ {telemetry.length} Online</span>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3 text-[10px] sm:text-[11px] text-slate-400 font-mono flex-wrap">
            <span className="text-rose-400 font-bold">{liveCourtsCount} Live</span>
            <span>•</span>
            <span className="text-amber-400 font-bold">{readyCourtsCount} Assigned</span>
            <span>•</span>
            <span className="text-emerald-400 font-bold">{vacantCourtsCount} Vacant</span>
          </div>
        </div>

        {/* Live Active Matches */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-lg space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
              Live Bouts
            </span>
            <span className="p-1.5 sm:p-2 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg sm:rounded-xl">
              <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-rose-400 font-mono flex items-center space-x-2">
            <span>{liveCourtsCount}</span>
            {liveCourtsCount > 0 && (
              <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-rose-500 animate-ping"></span>
            )}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
            Real-time rounds actively scored.
          </p>
        </div>

        {/* Queued Matches */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-lg space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
              On-Deck Queue
            </span>
            <span className="p-1.5 sm:p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg sm:rounded-xl">
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-amber-400 font-mono">
            {queue.length}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
            {queue.filter((q) => q.queueState === 'READY').length} ready for dispatch.
          </p>
        </div>

        {/* Incident & Health Oversight */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-lg space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
              Telemetry Sync
            </span>
            <span className="p-1.5 sm:p-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg sm:rounded-xl">
              <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="text-xs sm:text-sm font-bold text-emerald-400 font-mono flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>SUB_ACTIVE</span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono truncate">
            {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : 'Awaiting sync'}
          </p>
        </div>
      </div>

      {/* Live Bouts Immediate Oversight List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3.5 sm:p-6 shadow-xl space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 sm:pb-3">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-rose-400 animate-pulse" />
            <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
              Active Ring Combat Status ({liveBouts.length} Live)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToStation('COURT_OPERATIONS')}
            className="text-[11px] sm:text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center space-x-1 min-h-[36px]"
          >
            <span>Open Court Ops</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {liveBouts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {liveBouts.map(({ courtName, match }) => (
              <div
                key={match.matchId}
                className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between gap-3 hover:border-slate-700 transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 font-mono font-bold text-[10px]">
                      {courtName}
                    </span>
                    <span className="text-xs font-bold text-white">
                      Match #{match.matchNumber} ({match.eventName})
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 flex items-center space-x-2">
                    <span className="text-rose-400 font-semibold">{match.redAthlete.athleteName}</span>
                    <span className="text-slate-500 font-mono">({match.redAthlete.score})</span>
                    <span className="text-slate-600 font-bold">VS</span>
                    <span className="text-blue-400 font-semibold">{match.blueAthlete.athleteName}</span>
                    <span className="text-slate-500 font-mono">({match.blueAthlete.score})</span>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-mono font-bold shrink-0">
                  ROUND {match.currentRound}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-slate-950/60 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs space-y-1">
            <p>No active bouts are currently LIVE across arena rings.</p>
            <p className="text-slate-600">Dispatch queued matches from the Court Operations center to initiate ring combat.</p>
          </div>
        )}
      </div>

      {/* Six Operational Stations Hub Navigation Cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-2">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>Operational Command Stations</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Station 2: Court Ops */}
          <div
            onClick={() => onNavigateToStation('COURT_OPERATIONS')}
            className="bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-5 transition-all cursor-pointer group shadow-lg flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="p-2.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl">
                  <Layers className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-400">STATION 02</span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                Court Operations Center
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ring station cards, load-balanced bout dispatching, arena projector boards, and official shift rotations.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-blue-400 pt-3 border-t border-slate-800/80">
              <span>{telemetry.length} Rings Configured</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Station 3: Scoring Desk */}
          <div
            onClick={() => onNavigateToStation('SCORING_DESK')}
            className="bg-slate-900 border border-slate-800 hover:border-red-500/50 rounded-2xl p-5 transition-all cursor-pointer group shadow-lg flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="p-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl">
                  <Award className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-400">STATION 03</span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-red-400 transition-colors">
                Scoring Supervision Desk
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Chief referee arbitration, score tie resolution, advantage confirmations, and official scoring console triggers.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-red-400 pt-3 border-t border-slate-800/80">
              <span>Arbitration Oversight</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Station 4: Registration & Weigh-In */}
          <div
            onClick={() => onNavigateToStation('REGISTRATION_WEIGHIN')}
            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-5 transition-all cursor-pointer group shadow-lg flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="p-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
                  <Scale className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-400">STATION 04</span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">
                Registration &amp; Weigh-In Desk
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Athlete check-in compliance, official scale recording, division certification, and delegation lineup roster audits.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-emerald-400 pt-3 border-t border-slate-800/80">
              <span>Athlete Certification</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Station 5: Tech & Diagnostics */}
          <div
            onClick={() => onNavigateToStation('TECH_AUDIT')}
            className="bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-5 transition-all cursor-pointer group shadow-lg flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl">
                  <Cpu className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-400">STATION 05</span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-purple-400 transition-colors">
                Tech &amp; Platform Diagnostics
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Real-time WebSocket replication telemetry, server-side RBAC verification, and assignment reconciliation.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-purple-400 pt-3 border-t border-slate-800/80">
              <span>System Health</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Station 6: Incident & Recovery */}
          <div
            onClick={() => onNavigateToStation('INCIDENT_RECOVERY')}
            className="bg-slate-900 border border-slate-800 hover:border-rose-500/50 rounded-2xl p-5 transition-all cursor-pointer group shadow-lg flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="p-2.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-xl">
                  <ShieldAlert className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-400">STATION 06</span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-rose-400 transition-colors">
                Incident &amp; Recovery Station
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Append-only incident ledger (P7-03B), emergency match cancellation, medical timeout records, and dispute audit trails.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-rose-400 pt-3 border-t border-slate-800/80">
              <span>Audit Ledger (RPC)</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
