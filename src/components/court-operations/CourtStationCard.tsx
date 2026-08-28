import React from 'react';
import { CourtTelemetry } from '../../types/courtOperations';
import { 
  Radio, 
  Layers, 
  ArrowRightLeft, 
  CheckCircle2, 
  Clock, 
  Play, 
  ShieldAlert,
  Users,
  Maximize2,
  AlertTriangle
} from 'lucide-react';

interface CourtStationCardProps {
  court: CourtTelemetry;
  allCourts: CourtTelemetry[];
  canManage: boolean;
  canScore: boolean;
  onOpenStation: (courtId: string) => void;
  onOpenAssignModal: (courtId: string) => void;
  onOpenIncidentModal: (courtId: string) => void;
  onReassignMatch?: (matchId: string, fromCourtId: string, toCourtId: string) => void;
  onOpenArbitrationModal?: (matchId: string) => void;
  onOpenProjector?: (court: CourtTelemetry) => void;
}

export const CourtStationCard: React.FC<CourtStationCardProps> = ({
  court,
  allCourts,
  canManage,
  canScore,
  onOpenStation,
  onOpenAssignModal,
  onOpenIncidentModal,
  onReassignMatch,
  onOpenProjector,
}) => {
  // Derive available alternate courts for quick reassignment
  const eligibleReassignCourts = allCourts.filter(
    (c) => c.courtId !== court.courtId && c.isActive && c.state !== 'LIVE'
  );

  // Check Table Official Coverage on operational rings
  const hasTableOfficial = (court.assignedOfficials || []).some(
    (off) => off.role === 'TABLE_OFFICIAL' && (off.courtId === court.courtId || off.courtId === null)
  );
  const isMissingOfficialCoverage = court.isActive && court.state !== 'OFFLINE' && !hasTableOfficial;

  const getStatusBadge = () => {
    switch (court.state) {
      case 'LIVE':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center space-x-1 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            <span>LIVE BOUT</span>
          </span>
        );
      case 'ASSIGNED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
            <Clock className="w-3 h-3 text-amber-400" />
            <span>CALLED / ASSIGNED</span>
          </span>
        );
      case 'OFFLINE':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-500 border border-slate-700">
            OFFLINE
          </span>
        );
      case 'AVAILABLE':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            VACANT / READY
          </span>
        );
    }
  };

  return (
    <div className={`bg-slate-900 border rounded-xl sm:rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between transition-all relative overflow-hidden ${
      court.state === 'LIVE'
        ? 'border-rose-500/40 shadow-rose-950/20 shadow-lg ring-1 ring-rose-500/30'
        : court.state === 'ASSIGNED'
        ? 'border-amber-500/40 shadow-md'
        : 'border-slate-800 hover:border-slate-700 shadow'
    }`}>
      {/* Header */}
      <div className="space-y-3 sm:space-y-4">
        <div className="flex items-start sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0 flex-1">
            <div className={`p-1.5 sm:p-2 rounded-xl border shrink-0 ${
              court.state === 'LIVE'
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                : court.state === 'ASSIGNED'
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <Radio className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center space-x-1.5 sm:space-x-2 min-w-0">
                <span className="truncate">{court.courtName}</span>
                {!court.isActive && (
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">(Inactive)</span>
                )}
              </h4>
              <p className="text-[11px] sm:text-xs text-slate-400 font-mono truncate">
                {court.activeMatch ? `Match #${court.activeMatch.matchNumber}` : 'No active match'}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            {getStatusBadge()}
          </div>
        </div>

        {/* Active Bout Telemetry */}
        {court.activeMatch ? (
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-2.5 sm:p-3.5 space-y-2 sm:space-y-2.5">
            <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-1.5 sm:pb-2 gap-2">
              <span className="text-slate-400 truncate flex-1 min-w-0 text-[11px] sm:text-xs">
                {court.activeMatch.eventName || 'Tournament Bout'}
              </span>
              <span className="font-mono text-amber-400 font-bold shrink-0 text-[11px] sm:text-xs">
                {court.activeMatch.roundName || `Round ${court.activeMatch.currentRound}`}
              </span>
            </div>

            {/* Corner Athletes */}
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-xs">
              {/* Red Corner */}
              <div className="p-1.5 sm:p-2 rounded-lg bg-rose-950/30 border border-rose-900/40 text-rose-200 min-w-0">
                <div className="text-[9px] sm:text-[10px] text-rose-400 font-bold uppercase tracking-wider truncate">Red Corner</div>
                <div className="font-semibold truncate text-[11px] sm:text-xs mt-0.5" title={court.activeMatch.redAthlete.athleteName}>
                  {court.activeMatch.redAthlete.athleteName}
                </div>
                <div className="text-[9px] sm:text-[10px] text-rose-400/80 truncate" title={court.activeMatch.redAthlete.teamName || 'Independent'}>
                  {court.activeMatch.redAthlete.teamName || 'Independent'}
                </div>
              </div>

              {/* Blue Corner */}
              <div className="p-1.5 sm:p-2 rounded-lg bg-blue-950/30 border border-blue-900/40 text-blue-200 min-w-0">
                <div className="text-[9px] sm:text-[10px] text-blue-400 font-bold uppercase tracking-wider truncate">Blue Corner</div>
                <div className="font-semibold truncate text-[11px] sm:text-xs mt-0.5" title={court.activeMatch.blueAthlete.athleteName}>
                  {court.activeMatch.blueAthlete.athleteName}
                </div>
                <div className="text-[9px] sm:text-[10px] text-blue-400/80 truncate" title={court.activeMatch.blueAthlete.teamName || 'Independent'}>
                  {court.activeMatch.blueAthlete.teamName || 'Independent'}
                </div>
              </div>
            </div>

            {/* Live Scores summary if available */}
            {court.state === 'LIVE' && (
              <div className="flex items-center justify-between px-1.5 sm:px-2 pt-1 text-xs font-mono text-slate-300 gap-1">
                <span className="text-rose-400 font-bold shrink-0">{court.activeMatch.redAthlete.score ?? 0} pts</span>
                <span className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-widest text-center truncate">Live Score</span>
                <span className="text-blue-400 font-bold shrink-0">{court.activeMatch.blueAthlete.score ?? 0} pts</span>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-xl p-4 sm:p-6 text-center text-xs text-slate-500 space-y-1">
            <Layers className="w-4 h-4 sm:w-5 sm:h-5 mx-auto text-slate-600 mb-1" />
            <p className="font-medium text-slate-400">Ring is currently Vacant</p>
            <p className="text-[10px] sm:text-[11px]">Ready for queue match dispatch</p>
          </div>
        )}
        {/* Official Coverage & Official Assignment Status */}
        {isMissingOfficialCoverage ? (
          <div className="flex items-center space-x-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="break-words text-[11px] sm:text-xs">Coverage Warning: No Table Official assigned to this ring</span>
          </div>
        ) : court.assignedOfficials && court.assignedOfficials.length > 0 ? (
          <div className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1 rounded-xl bg-slate-950/60 border border-slate-800/80 text-slate-400 text-[10px] sm:text-[11px] min-w-0">
            <Users className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="truncate flex-1 min-w-0">
              Table Official: {court.assignedOfficials.find((o) => o.role === 'TABLE_OFFICIAL')?.fullName || 'Assigned'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Action Footer */}
      <div className="pt-3 sm:pt-4 mt-3 sm:mt-4 border-t border-slate-800 space-y-2">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* OFFLINE / PAUSED STATE */}
          {court.state === 'OFFLINE' || !court.isActive ? (
            <div className="flex-1 py-2 px-3 bg-slate-950 border border-slate-800/80 rounded-xl text-[11px] text-slate-500 font-medium flex items-center justify-center space-x-1.5 min-h-[40px]">
              <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0"></span>
              <span>Ring Offline / Paused</span>
            </div>
          ) : court.activeMatch ? (
            /* ACTIVE MATCH STATE: ASSIGNED or LIVE */
            canScore ? (
              <button
                type="button"
                onClick={() => onOpenStation(court.courtId)}
                className={`flex-1 py-2 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 shadow min-h-[40px] ${
                  court.state === 'LIVE'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/30 ring-1 ring-rose-400/40 animate-pulse'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Enter Live Scoring</span>
              </button>
            ) : (
              <div className="flex-1 py-2 px-3 bg-slate-950/80 border border-slate-800 rounded-xl text-[11px] text-slate-400 font-medium flex items-center justify-center space-x-1.5 min-h-[40px]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Match In Progress</span>
              </div>
            )
          ) : (
            /* VACANT / READY STATE: No Active Match */
            canManage ? (
              <button
                type="button"
                onClick={() => onOpenAssignModal(court.courtId)}
                className="flex-1 py-2 px-2.5 sm:px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all flex items-center justify-center space-x-1.5 shadow min-h-[40px]"
              >
                <Layers className="w-3.5 h-3.5 text-slate-950" />
                <span>Dispatch Match</span>
              </button>
            ) : canScore ? (
              <button
                type="button"
                onClick={() => onOpenStation(court.courtId)}
                className="flex-1 py-2 px-2.5 sm:px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 min-h-[40px]"
              >
                <Play className="w-3.5 h-3.5 text-amber-400" />
                <span>Open Station</span>
              </button>
            ) : (
              <div className="flex-1 py-2 px-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-[11px] text-slate-500 font-medium flex items-center justify-center space-x-1.5 min-h-[40px]">
                <span>Awaiting Dispatch</span>
              </div>
            )
          )}

          {/* CLASS C SECONDARY UTILITIES */}
          {/* Arena Projector Trigger */}
          {onOpenProjector && (
            <button
              type="button"
              onClick={() => onOpenProjector(court)}
              className="p-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-slate-700/80 rounded-xl transition-all min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
              title="Open Full-Screen Arena Projector for this Ring"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}

          {/* Incident / Emergency Logging Trigger */}
          {canManage && (
            <button
              type="button"
              onClick={() => onOpenIncidentModal(court.courtId)}
              className="p-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-700/80 rounded-xl transition-all min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
              title="Log Ring Incident or Medical Timeout"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* CLASS B CONTEXTUAL ACTION: Quick Reassignment for ASSIGNED Matches (Not LIVE) */}
        {canManage && court.activeMatch && court.state !== 'LIVE' && court.state !== 'OFFLINE' && onReassignMatch && eligibleReassignCourts.length > 0 && (
          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
            <span className="text-[10px] sm:text-[11px] text-slate-400 flex items-center space-x-1">
              <ArrowRightLeft className="w-3 h-3 text-amber-400" />
              <span>Reassign:</span>
            </span>
            <select
              onChange={(e) => {
                if (e.target.value && court.activeMatch) {
                  onReassignMatch(court.activeMatch.matchId, court.courtId, e.target.value);
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] sm:text-[11px] text-slate-300 font-medium focus:outline-none focus:border-amber-500 cursor-pointer max-w-[65%]"
            >
              <option value="" disabled>Select Target Ring...</option>
              {eligibleReassignCourts.map((c) => (
                <option key={c.courtId} value={c.courtId}>
                  {c.courtName} ({c.state})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};
