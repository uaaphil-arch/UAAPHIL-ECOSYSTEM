import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isTabAuthorized, resolvePrimaryAssignment } from '../../utils/authorization';
import { tournamentService } from '../../services/tournamentService';
import { courtOperationsService } from '../../services/courtOperationsService';
import { supabase } from '../../lib/supabase';
import { Tournament } from '../../types/tournament';
import { CourtTelemetry, EnrichedQueueMatch } from '../../types/courtOperations';
import {
  OPERATIONAL_STATIONS_METADATA,
  OperationalStationId,
} from '../../types/commandCenter';
import { 
  ShieldCheck, 
  UserCheck, 
  Key, 
  Lock, 
  ExternalLink,
  Crown,
  Layers,
  Award,
  Scale,
  Cpu,
  ShieldAlert,
  Activity,
  RefreshCw,
  Radio,
  AlertTriangle,
  ArrowRight,
  Trophy
} from 'lucide-react';

interface ConciseDashboardProps {
  onNavigate: (tab: string) => void;
}

const formatTournamentStatus = (status: string) => {
  switch (status) {
    case 'REGISTRATION_OPEN':
      return 'Registration Open';
    case 'REGISTRATION_CLOSED':
      return 'Registration Closed';
    case 'ONGOING':
      return 'Ongoing';
    case 'COMPLETED':
      return 'Completed';
    case 'DRAFT':
      return 'Draft';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
};

interface CommandKpiMetrics {
  activeRings: number;
  totalRings: number;
  liveBouts: number;
  onDeckMatches: number;
  totalMatches: number;
  completedMatches: number;
  totalRegistrations: number;
  weighInClearedCount: number;
  weighInClearancePct: number | null;
  openIncidentsCount: number;
}

export const ConciseDashboard: React.FC<ConciseDashboardProps> = ({ onNavigate }) => {
  const { user, profile, roles, activeAssignments, hasActiveOperationalAssignment } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isOrganizer = roles.includes('ORGANIZER') || roles.includes('ADMIN');

  const primaryAssignment = resolvePrimaryAssignment(activeAssignments);

  // Operational command center is visible to administrative & tournament operations roles
  const canAccessCommandCenter = isSuperAdmin || isOrganizer;

  // State for Tournament Command Center
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [selectedStation, setSelectedStation] = useState<OperationalStationId | 'ALL'>('ALL');
  const [, setTelemetry] = useState<CourtTelemetry[]>([]);
  const [, setMatchQueue] = useState<EnrichedQueueMatch[]>([]);
  const [kpis, setKpis] = useState<CommandKpiMetrics>({
    activeRings: 0,
    totalRings: 0,
    liveBouts: 0,
    onDeckMatches: 0,
    totalMatches: 0,
    completedMatches: 0,
    totalRegistrations: 0,
    weighInClearedCount: 0,
    weighInClearancePct: null,
    openIncidentsCount: 0,
  });
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState<boolean>(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // 1. Fetch available tournaments
  const loadTournaments = useCallback(async () => {
    try {
      const list = await tournamentService.getTournaments();
      setTournaments(list || []);
      if (list && list.length > 0 && !selectedTournamentId) {
        const activeT = list.find((t) => t.status === 'ONGOING') ||
          list.find((t) => t.status === 'REGISTRATION_CLOSED') ||
          list.find((t) => t.status === 'REGISTRATION_OPEN') ||
          list[0];
        setSelectedTournamentId(activeT.id);
      }
    } catch (err) {
      console.warn('Could not load tournaments for Command Center:', err);
    }
  }, [selectedTournamentId]);

  useEffect(() => {
    if (canAccessCommandCenter) {
      loadTournaments();
    }
  }, [canAccessCommandCenter, loadTournaments]);

  // 2. Fetch telemetry and KPIs for selected tournament
  const loadTournamentTelemetry = useCallback(async (tId: string) => {
    if (!tId) return;
    setIsLoadingTelemetry(true);
    setTelemetryError(null);

    try {
      const [telemetryRes, queueRes, regCountRes, weighInPassedRes, incidentsRes] = await Promise.all([
        courtOperationsService.fetchTournamentCourtsTelemetry(tId).catch((err) => {
          console.warn('Telemetry fetch non-blocking notice:', err);
          return [] as CourtTelemetry[];
        }),
        courtOperationsService.fetchEnrichedMatchQueue(tId).catch((err) => {
          console.warn('Queue fetch non-blocking notice:', err);
          return [] as EnrichedQueueMatch[];
        }),
        supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', tId),
        supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', tId)
          .eq('weigh_in_status', 'PASSED'),
        supabase
          .from('system_audit_logs')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', tId),
      ]);

      const activeRingsCount = telemetryRes.filter((c) => c.isActive).length;
      const liveBoutsCount = telemetryRes.filter((c) => c.state === 'LIVE').length;
      const onDeckCount = queueRes.filter((q) => q.queueState === 'READY' || q.queueState === 'ASSIGNED').length;
      const completedCount = queueRes.filter((q) => q.queueState === 'COMPLETED').length;
      const totalRegs = regCountRes.count || 0;
      const weighInCleared = weighInPassedRes.count || 0;
      const clearancePct = totalRegs > 0 ? Math.round((weighInCleared / totalRegs) * 100) : null;
      const incidentsCount = incidentsRes.count || 0;

      setTelemetry(telemetryRes);
      setMatchQueue(queueRes);
      setKpis({
        activeRings: activeRingsCount,
        totalRings: telemetryRes.length,
        liveBouts: liveBoutsCount,
        onDeckMatches: onDeckCount,
        totalMatches: queueRes.length,
        completedMatches: completedCount,
        totalRegistrations: totalRegs,
        weighInClearedCount: weighInCleared,
        weighInClearancePct: clearancePct,
        openIncidentsCount: incidentsCount,
      });
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve telemetry.';
      setTelemetryError(msg);
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, []);

  useEffect(() => {
    if (canAccessCommandCenter && selectedTournamentId) {
      loadTournamentTelemetry(selectedTournamentId);

      const unsubscribe = courtOperationsService.subscribeToCourtOperations(
        selectedTournamentId,
        () => {
          loadTournamentTelemetry(selectedTournamentId);
        }
      );

      return () => {
        unsubscribe();
      };
    }
  }, [canAccessCommandCenter, selectedTournamentId, loadTournamentTelemetry]);

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);

  const getStationIcon = (stationId: OperationalStationId) => {
    switch (stationId) {
      case 'DIRECTOR_HUB':
        return Crown;
      case 'COURT_OPERATIONS':
        return Layers;
      case 'SCORING_DESK':
        return Award;
      case 'REGISTRATION_WEIGHIN':
        return Scale;
      case 'TECH_AUDIT':
        return Cpu;
      case 'INCIDENT_RECOVERY':
        return ShieldAlert;
    }
  };

  const handleStationNavigate = (stationId: OperationalStationId) => {
    if (!isStationAuthorized(stationId)) return;
    try {
      window.sessionStorage?.setItem('uaaphil_target_command_station', stationId);
      if (selectedTournamentId) {
        window.sessionStorage?.setItem('uaaphil_target_command_tournament', selectedTournamentId);
      }
    } catch {
      // Non-blocking storage access
    }
    onNavigate('competition');
  };

  const isStationAuthorized = (stationId: OperationalStationId): boolean => {
    if (isSuperAdmin) return true;
    if (isOrganizer) return true;
    return false;
  };

  return (
    <div className="space-y-6">
      {/* Summary Greeting Banner */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl p-6 sm:p-7 shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
              <span>UAAPHIL Master Architecture</span>
              <span className="text-[10px] opacity-75">• Official Command Center</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Welcome, {profile?.full_name || user?.email || 'User'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Tournament operations, role delegation, and system security overview.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('diagnostics')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shadow"
              >
                <span>Inspect Database</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Operational Station Discovery Card (P23-08: Dual-Authority Scoped Workstation Access) */}
      {hasActiveOperationalAssignment && primaryAssignment && (
        <div className="bg-gradient-to-r from-emerald-950/50 via-slate-900 to-slate-900 border border-emerald-500/40 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Active Operational Assignment</span>
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>
                    {primaryAssignment.role === 'TABLE_OFFICIAL'
                      ? 'Table Official Station'
                      : 'Court Manager Operations'}
                  </span>
                  {primaryAssignment.court_name && (
                    <span className="text-emerald-400 text-sm font-semibold">
                      — {primaryAssignment.court_name}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {primaryAssignment.role === 'TABLE_OFFICIAL'
                    ? 'Active table official assignment detected for your account. You can directly access the Live Competition workstation to execute match queuing and score recording.'
                    : 'Active court manager assignment detected for your account. You can directly access the Live Operations command center to oversee tournament courts and match queues.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('competition')}
              className="w-full sm:w-auto px-5 py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 shrink-0 group"
            >
              <span>
                {primaryAssignment.role === 'TABLE_OFFICIAL'
                  ? 'Launch Assigned Court Station'
                  : 'Launch Operations Center'}
              </span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* P5-01: TOURNAMENT DAY COMMAND CENTER AGGREGATION HUB (ADMIN / OPS ROLES) */}
      {/* ========================================================================= */}
      {canAccessCommandCenter && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6 shadow-xl relative overflow-hidden">
          {/* Command Center Header & Tournament Selector */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-500/15 text-amber-400 rounded-xl border border-amber-500/30">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    Tournament Day Command Center
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-semibold">
                    LIVE TELEMETRY
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Unified operational aggregation across rings, weigh-in, scoring, and arbitration.
                </p>
              </div>
            </div>

            {/* Tournament Selector & Refresh Trigger */}
            <div className="flex items-center space-x-3">
              {tournaments.length > 0 ? (
                <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5">
                  <Trophy className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <select
                    value={selectedTournamentId}
                    onChange={(e) => setSelectedTournamentId(e.target.value)}
                    className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[200px] sm:max-w-xs truncate"
                  >
                    {tournaments.map((t) => (
                      <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                        {t.name} ({formatTournamentStatus(t.status)})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="text-xs text-slate-500 italic">No tournaments found</span>
              )}

              <button
                type="button"
                onClick={() => selectedTournamentId && loadTournamentTelemetry(selectedTournamentId)}
                disabled={isLoadingTelemetry || !selectedTournamentId}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-all disabled:opacity-50"
                title="Refresh Live Telemetry"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingTelemetry ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Error Banner if telemetry fails */}
          {telemetryError && (
            <div className="p-3.5 bg-rose-950/50 border border-rose-800/80 rounded-xl flex items-center space-x-3 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>Telemetry Notice: {telemetryError}</span>
            </div>
          )}

          {/* Operational KPI Metrics Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Active Rings */}
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Active Rings</span>
                <Radio className={`w-3.5 h-3.5 ${kpis.activeRings > 0 ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
              </div>
              <div className="text-xl font-bold text-white font-mono">
                {isLoadingTelemetry ? '...' : `${kpis.activeRings} / ${kpis.totalRings || 0}`}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {kpis.activeRings > 0 ? `${kpis.activeRings} ring(s) broadcasting` : 'No rings online'}
              </div>
            </div>

            {/* Live Bouts */}
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Live Bouts</span>
                <span className={`w-2 h-2 rounded-full ${kpis.liveBouts > 0 ? 'bg-rose-500 animate-ping' : 'bg-slate-600'}`} />
              </div>
              <div className="text-xl font-bold text-rose-400 font-mono">
                {isLoadingTelemetry ? '...' : kpis.liveBouts}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {kpis.liveBouts > 0 ? 'Simultaneous combat active' : 'No bouts live'}
              </div>
            </div>

            {/* On-Deck Matches */}
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">On-Deck Queue</span>
                <Layers className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-xl font-bold text-amber-400 font-mono">
                {isLoadingTelemetry ? '...' : kpis.onDeckMatches}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {`${kpis.completedMatches} / ${kpis.totalMatches} bouts complete`}
              </div>
            </div>

            {/* Weigh-In Clearance % */}
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Weigh-In Clearance</span>
                <Scale className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xl font-bold text-emerald-400 font-mono">
                {isLoadingTelemetry ? '...' : (kpis.weighInClearancePct !== null ? `${kpis.weighInClearancePct}%` : 'N/A')}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {kpis.totalRegistrations > 0 ? `${kpis.weighInClearedCount} / ${kpis.totalRegistrations} passed` : '0 athletes registered'}
              </div>
            </div>

            {/* Open Incidents / Audit */}
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-1 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Audit & Incidents</span>
                <ShieldAlert className={`w-3.5 h-3.5 ${kpis.openIncidentsCount > 0 ? 'text-purple-400' : 'text-slate-500'}`} />
              </div>
              <div className="text-xl font-bold text-purple-400 font-mono">
                {isLoadingTelemetry ? '...' : kpis.openIncidentsCount}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {lastRefreshedAt ? `Synced ${lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sync pending'}
              </div>
            </div>
          </div>

          {/* Station Filter Pills */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Functional Operational Stations
              </span>
              <span className="text-[11px] text-slate-500">
                Click any station card to open dedicated operational console
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedStation('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedStation === 'ALL'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                All Stations (6)
              </button>
              {(Object.keys(OPERATIONAL_STATIONS_METADATA) as OperationalStationId[]).map((stId) => {
                const meta = OPERATIONAL_STATIONS_METADATA[stId];
                const authorized = isStationAuthorized(stId);
                return (
                  <button
                    key={stId}
                    type="button"
                    onClick={() => setSelectedStation(stId)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                      selectedStation === stId
                        ? 'bg-slate-200 text-slate-900 shadow-md font-bold'
                        : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    } ${!authorized ? 'opacity-50' : ''}`}
                  >
                    <span>{meta.shortLabel}</span>
                    {!authorized && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The Six Station Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.keys(OPERATIONAL_STATIONS_METADATA) as OperationalStationId[])
              .filter((stId) => selectedStation === 'ALL' || selectedStation === stId)
              .map((stId) => {
                const meta = OPERATIONAL_STATIONS_METADATA[stId];
                const IconComponent = getStationIcon(stId);
                const authorized = isStationAuthorized(stId);

                // Specific card contextual stats
                let statSummary = '';
                let statusBadge = 'STANDBY';
                let statusBadgeClass = 'bg-slate-800 text-slate-400 border-slate-700';

                switch (stId) {
                  case 'DIRECTOR_HUB':
                    statSummary = `Tournament Status: ${selectedTournament ? formatTournamentStatus(selectedTournament.status) : 'Active'}`;
                    statusBadge = selectedTournament?.status === 'ONGOING' ? 'LIVE' : (selectedTournament ? formatTournamentStatus(selectedTournament.status) : 'READY');
                    statusBadgeClass = selectedTournament?.status === 'ONGOING' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-slate-800 text-slate-300 border-slate-700';
                    break;
                  case 'COURT_OPERATIONS':
                    statSummary = `${kpis.activeRings} active rings • ${kpis.onDeckMatches} in dispatch queue`;
                    statusBadge = kpis.liveBouts > 0 ? 'ACTIVE' : (kpis.activeRings > 0 ? 'READY' : 'OFFLINE');
                    statusBadgeClass = statusBadge === 'ACTIVE' ? 'bg-blue-950 text-blue-300 border-blue-800' : (statusBadge === 'READY' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-slate-800 text-slate-400 border-slate-700');
                    break;
                  case 'SCORING_DESK':
                    statSummary = `${kpis.liveBouts} live bout(s) currently being scored`;
                    statusBadge = kpis.liveBouts > 0 ? 'RECORDING' : 'IDLE';
                    statusBadgeClass = statusBadge === 'RECORDING' ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-slate-800 text-slate-400 border-slate-700';
                    break;
                  case 'REGISTRATION_WEIGHIN':
                    statSummary = `${kpis.weighInClearedCount} / ${kpis.totalRegistrations} athletes certified (${kpis.weighInClearancePct !== null ? `${kpis.weighInClearancePct}%` : 'N/A'})`;
                    statusBadge = kpis.weighInClearancePct === 100 ? 'CERTIFIED' : (kpis.totalRegistrations > 0 ? 'IN PROGRESS' : 'READY');
                    statusBadgeClass = statusBadge === 'CERTIFIED' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800';
                    break;
                  case 'TECH_AUDIT':
                    statSummary = 'Real-Time Channel & Data Integrity Operational';
                    statusBadge = 'NORMAL';
                    statusBadgeClass = 'bg-purple-950 text-purple-300 border-purple-800';
                    break;
                  case 'INCIDENT_RECOVERY':
                    statSummary = `${kpis.openIncidentsCount} logged ledger events for tournament`;
                    statusBadge = kpis.openIncidentsCount > 0 ? 'REVIEW' : 'CLEAR';
                    statusBadgeClass = kpis.openIncidentsCount > 0 ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-emerald-950 text-emerald-300 border-emerald-800';
                    break;
                }

                return (
                  <div
                    key={stId}
                    className={`bg-slate-950/80 border rounded-xl p-4 sm:p-5 flex flex-col justify-between transition-all group ${
                      authorized 
                        ? 'border-slate-800/80 hover:border-slate-700 hover:shadow-lg' 
                        : 'border-slate-900/50 opacity-60'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 group-hover:text-amber-400 transition-colors">
                          <IconComponent className="w-5 h-5" />
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${statusBadgeClass}`}>
                          {statusBadge}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                          {meta.label}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                          {meta.description}
                        </p>
                      </div>

                      <div className="p-2.5 bg-slate-900/60 border border-slate-800/60 rounded-lg text-[11px] text-slate-300 font-mono">
                        {statSummary}
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-slate-900 flex items-center justify-between">
                      {authorized ? (
                        <button
                          type="button"
                          onClick={() => handleStationNavigate(stId)}
                          className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center space-x-1.5 transition-all group/btn"
                        >
                          <span>Open Station Console</span>
                          <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 flex items-center space-x-1">
                          <Lock className="w-3 h-3" />
                          <span>Requires elevated role</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 4 Concise Status Cards Grid (For all users, preserving existing baseline) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Authentication */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3 hover:border-slate-600 transition-all">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-blue-500/15 text-blue-400 rounded-lg border border-blue-500/20">
              <Key className="w-4 h-4" />
            </div>
            <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-mono font-semibold">
              ACTIVE
            </span>
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Authentication</div>
            <div className="text-sm font-bold text-white mt-0.5">Google OAuth</div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">{user?.email || 'No email'}</p>
          </div>
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onNavigate('auth')}
              className="text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
            >
              <span>View Session</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* Card 2: Profile */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3 hover:border-slate-600 transition-all">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-emerald-500/15 text-emerald-400 rounded-lg border border-emerald-500/20">
              <UserCheck className="w-4 h-4" />
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
              (profile?.status || profile?.account_status) === 'ACTIVE'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-amber-950 text-amber-300 border-amber-800'
            }`}>
              {profile?.status || profile?.account_status || 'ACTIVE'}
            </span>
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">User Profile</div>
            <div className="text-sm font-bold text-white mt-0.5">
              {profile?.full_name || 'Profile Loaded'}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Delegation Account Active</p>
          </div>
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium flex items-center space-x-1"
            >
              <span>Edit Profile</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* Card 3: Permanent Roles */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3 hover:border-slate-600 transition-all">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-purple-500/15 text-purple-400 rounded-lg border border-purple-500/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="px-2 py-0.5 bg-purple-950 text-purple-300 border border-purple-800 rounded text-[10px] font-mono font-semibold">
              {roles.length} {roles.length === 1 ? 'ROLE' : 'ROLES'}
            </span>
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">System Roles</div>
            <div className="text-sm font-bold text-white mt-0.5 flex flex-wrap gap-1">
              {roles.length === 0 ? (
                <span className="text-xs text-slate-500 italic">Ordinary User</span>
              ) : (
                roles.map((r) => (
                  <span
                    key={r}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
                      r === 'SUPER_ADMIN' ? 'text-amber-400' : 'text-purple-300'
                    }`}
                  >
                    {r}
                  </span>
                ))
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Verified Permissions</p>
          </div>
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => onNavigate('roles')}
                className="text-[11px] text-purple-400 hover:text-purple-300 font-medium flex items-center space-x-1"
              >
                <span>Manage Roles</span>
                <span>→</span>
              </button>
            ) : (
              <span className="text-[11px] text-slate-500">Read-Only</span>
            )}
          </div>
        </div>

        {/* Card 4: Security */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-5 space-y-3 hover:border-slate-600 transition-all">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-amber-500/15 text-amber-400 rounded-lg border border-amber-500/20">
              <Lock className="w-4 h-4" />
            </div>
            <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-mono font-semibold">
              ENFORCED
            </span>
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Security Status</div>
            <div className="text-sm font-bold text-white mt-0.5">Role Authorization</div>
            <p className="text-[11px] text-slate-400 mt-1">Active Protection</p>
          </div>
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-emerald-400 font-medium">Session Verified</span>
            <span className="text-[11px] text-slate-400 font-medium">Authoritative</span>
          </div>
        </div>
      </div>

      {/* Quick Navigation / Module Shortcuts - Authorized Only */}
      {(isTabAuthorized('tournaments', roles) || isTabAuthorized('competition', roles, hasActiveOperationalAssignment) || isTabAuthorized('registrations', roles) || isTabAuthorized('team_management', roles) || isTabAuthorized('reports', roles) || isSuperAdmin) && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Authorized System Modules
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => onNavigate('athlete_hub')}
              className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-amber-500/50 hover:border-amber-400 rounded-xl text-left transition-all group"
            >
              <div className="font-bold text-xs text-amber-400 group-hover:text-amber-300">My Athlete Hub</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Club status, registrations &amp; achievements</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('arena_schedule')}
              className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
            >
              <div className="font-bold text-xs text-amber-400">Live Arena Schedule</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Real-time rings, on deck &amp; athlete search</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('rankings')}
              className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
            >
              <div className="font-bold text-xs text-slate-200">Rankings &amp; Medals</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Team tally &amp; athlete podiums</p>
            </button>

            {isTabAuthorized('team_management', roles) && (
              <button
                type="button"
                onClick={() => onNavigate('team_management')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-emerald-500/40 hover:border-emerald-500/80 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-emerald-400">Team Management</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Manage club roster, applications &amp; transfers</p>
              </button>
            )}

            {isTabAuthorized('tournaments', roles) && (
              <button
                type="button"
                onClick={() => onNavigate('tournaments')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-white">Tournament Management</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Immutable snapshots & configurations</p>
              </button>
            )}

            {isTabAuthorized('competition', roles, hasActiveOperationalAssignment) && (
              <button
                type="button"
                onClick={() => onNavigate('competition')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-rose-300">Live Competition</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Court queue & Full Contact scoring</p>
              </button>
            )}

            {isTabAuthorized('registrations', roles) && (
              <button
                type="button"
                onClick={() => onNavigate('registrations')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-white">Athlete Registrations</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Delegation rosters & categories</p>
              </button>
            )}

            {isTabAuthorized('reports', roles) && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-white">Reports &amp; Books</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Official result books &amp; certificates</p>
              </button>
            )}

            {isTabAuthorized('branding', roles) && (
              <button
                type="button"
                onClick={() => onNavigate('branding')}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all"
              >
                <div className="font-bold text-xs text-white">Logo &amp; Branding</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Upload logo & manage system assets</p>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
