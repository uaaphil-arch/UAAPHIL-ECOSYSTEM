import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  OperationalStationId,
  OPERATIONAL_STATIONS_METADATA,
} from '../../types/commandCenter';
import { Tournament, TournamentSnapshot } from '../../types/tournament';
import { CourtOperationsMetrics, CourtTelemetry, EnrichedQueueMatch, SystemAuditLogEntry } from '../../types/courtOperations';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { courtOperationsService } from '../../services/courtOperationsService';
import { CommandCenterSopDrawer } from './CommandCenterSopDrawer';
import {
  Activity,
  Trophy,
  Users,
  RefreshCw,
  Crown,
  Layers,
  Award,
  Scale,
  Cpu,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  AlertTriangle,
  Radio,
  Clock,
  Flame,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Info,
  Filter,
} from 'lucide-react';

export interface CommandCenterLayoutProps {
  activeStation: OperationalStationId;
  onStationChange: (station: OperationalStationId) => void;
  tournaments: Tournament[];
  selectedTournamentId: string;
  onTournamentChange: (id: string) => void;
  snapshot: TournamentSnapshot | null;
  metrics: CourtOperationsMetrics | null;
  telemetry: CourtTelemetry[];
  queue: EnrichedQueueMatch[];
  isLoading: boolean;
  lastSyncedAt: Date | null;
  onRefresh: () => void;
  canManage: boolean;
  onOpenOfficialRotationModal?: () => void;
  errorMessage?: string | null;
  children: React.ReactNode;
}

// Local Normalized Attention Item Model (P22.24-C)
export type AttentionSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  severityWeight: number;
  title: string;
  description: string;
  timestamp?: number;
  targetStation: OperationalStationId;
  category: 'EMERGENCY' | 'COURT' | 'OFFICIAL' | 'SCORING' | 'QUEUE';
  actionLabel: string;
  onAction: () => void;
}

const STATION_ICONS: Record<OperationalStationId, React.ComponentType<{ className?: string }>> = {
  DIRECTOR_HUB: Crown,
  COURT_OPERATIONS: Layers,
  SCORING_DESK: Award,
  REGISTRATION_WEIGHIN: Scale,
  TECH_AUDIT: Cpu,
  INCIDENT_RECOVERY: ShieldAlert,
};

export const CommandCenterLayout: React.FC<CommandCenterLayoutProps> = ({
  activeStation,
  onStationChange,
  tournaments,
  selectedTournamentId,
  onTournamentChange,
  snapshot,
  metrics,
  telemetry,
  queue,
  isLoading,
  lastSyncedAt,
  onRefresh,
  canManage,
  onOpenOfficialRotationModal,
  errorMessage,
  children,
}) => {
  const { isOnline, isReconnecting } = useNetworkStatus();
  const [isSopDrawerOpen, setIsSopDrawerOpen] = useState(false);

  // P9-12: Direct Station Deep-Link & Navigation Harmonization from Dashboard
  useEffect(() => {
    try {
      const targetStation = window.sessionStorage?.getItem('uaaphil_target_command_station') as OperationalStationId | null;
      if (targetStation && Object.keys(OPERATIONAL_STATIONS_METADATA).includes(targetStation)) {
        window.sessionStorage.removeItem('uaaphil_target_command_station');
        if (activeStation !== targetStation) {
          onStationChange(targetStation);
        }
      }
      const targetTournament = window.sessionStorage?.getItem('uaaphil_target_command_tournament');
      if (targetTournament) {
        window.sessionStorage.removeItem('uaaphil_target_command_tournament');
        if (selectedTournamentId !== targetTournament && tournaments.some((t) => t.id === targetTournament)) {
          onTournamentChange(targetTournament);
        }
      }
    } catch {
      // Non-blocking storage access
    }
  }, [activeStation, onStationChange, selectedTournamentId, onTournamentChange, tournaments]);

  // Authoritative incident audit logs from public.get_tournament_incident_logs
  const [incidentLogs, setIncidentLogs] = useState<SystemAuditLogEntry[]>([]);
  const [isIncidentLogsLoading, setIsIncidentLogsLoading] = useState(false);

  // Load authoritative incident audit logs
  const loadIncidentLogs = useCallback(async (tId: string) => {
    if (!tId) {
      setIncidentLogs([]);
      return;
    }
    setIsIncidentLogsLoading(true);
    try {
      const logs = await courtOperationsService.fetchTournamentAuditLogs(tId);
      setIncidentLogs(logs || []);
    } catch (err) {
      console.error('Failed to fetch tournament incident logs for venue alert banner:', err);
    } finally {
      setIsIncidentLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadIncidentLogs(selectedTournamentId);
    } else {
      setIncidentLogs([]);
    }
  }, [selectedTournamentId, loadIncidentLogs]);

  // Subscribe to realtime audit log changes to keep venue emergency banner up to date
  useEffect(() => {
    if (!selectedTournamentId) return;

    const unsubscribe = courtOperationsService.subscribeToCourtOperations(
      selectedTournamentId,
      () => {
        loadIncidentLogs(selectedTournamentId);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [selectedTournamentId, loadIncidentLogs]);

  // Derive OPEN CRITICAL venue-wide emergency incidents from the authoritative audit ledger
  const venueEmergencyIncidents = useMemo(() => {
    if (!incidentLogs || incidentLogs.length === 0) return [];

    // Filter logs for CRITICAL severity
    const criticalLogs = incidentLogs.filter((log) => {
      const severity = log.details?.severity || (log.action?.includes('CRITICAL') ? 'CRITICAL' : 'INFO');
      return severity === 'CRITICAL';
    });

    // Check if the critical incident has been resolved/cleared by a subsequent action
    return criticalLogs.filter((critLog) => {
      const critTime = new Date(critLog.created_at).getTime();
      const entityId = critLog.entity_id;
      const entityType = critLog.entity_type;

      // Look for a subsequent resolution log on the same entity or tournament
      const hasResolution = incidentLogs.some((resLog) => {
        const resTime = new Date(resLog.created_at).getTime();
        if (resTime <= critTime) return false;

        const isResAction =
          resLog.action?.includes('RESOLV') ||
          resLog.action?.includes('COMPLETE') ||
          resLog.action?.includes('RESUME') ||
          resLog.action?.includes('CANCEL_RESOLVED') ||
          resLog.details?.status === 'RESOLVED';

        if (!isResAction) return false;

        if (entityId && resLog.entity_id === entityId) return true;
        if (entityType && resLog.entity_type === entityType && (!entityId || resLog.entity_id === entityId)) return true;
        if (resLog.action?.includes('EMERGENCY_RESOLUTION') && resLog.details?.match_id === entityId) return true;
        return false;
      });

      return !hasResolution;
    });
  }, [incidentLogs]);

  // Local Presentation State for Unified Attention & Exception Center (P22.24-C)
  const [isAttentionOpen, setIsAttentionOpen] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');

  // P22.24-C: Unified Attention & Exception Items Derivation
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    // 1. Unresolved CRITICAL Venue-Wide Emergencies from Authoritative Audit Ledger
    venueEmergencyIncidents.forEach((incident) => {
      const notes = incident.details?.notes || incident.details?.reason || incident.details?.description;
      const entityContext = incident.entity_type
        ? `${incident.entity_type}${incident.entity_id ? ` #${incident.entity_id.slice(0, 8)}` : ''}`
        : 'Arena Floor';
      const createdTs = new Date(incident.created_at).getTime();

      items.push({
        id: `attention-emergency-${incident.id}`,
        severity: 'CRITICAL',
        severityWeight: 400,
        title: `Venue Emergency: ${incident.action}`,
        description: notes || `Active arena emergency stoppage logged on ${entityContext}.`,
        timestamp: !isNaN(createdTs) ? createdTs : undefined,
        targetStation: 'INCIDENT_RECOVERY',
        category: 'EMERGENCY',
        actionLabel: 'Open Incident Recovery',
        onAction: () => onStationChange('INCIDENT_RECOVERY'),
      });
    });

    // 2. Ring OFFLINE with LIVE Bout Assigned
    telemetry.forEach((c) => {
      if (!c.isActive && c.activeMatch) {
        items.push({
          id: `attention-offline-live-${c.courtId}-${c.activeMatch.matchId}`,
          severity: 'CRITICAL',
          severityWeight: 400,
          title: `Ring Offline With Active Bout (${c.courtName})`,
          description: `Ring "${c.courtName}" is OFFLINE while Match #${c.activeMatch.matchNumber} is assigned as LIVE.`,
          targetStation: 'COURT_OPERATIONS',
          category: 'COURT',
          actionLabel: 'View Ring Operations',
          onAction: () => onStationChange('COURT_OPERATIONS'),
        });
      }
    });

    // 3. Missing Table Official on Active / Operational Rings
    telemetry.forEach((c) => {
      if (!c.isActive || c.state === 'OFFLINE') return;

      const hasTableOfficial = (c.assignedOfficials || []).some(
        (off) => off.role === 'TABLE_OFFICIAL' && (off.courtId === c.courtId || off.courtId === null)
      );

      if (!hasTableOfficial) {
        const isUrgent = c.state === 'LIVE' || c.state === 'ASSIGNED';
        items.push({
          id: `attention-coverage-${c.courtId}`,
          severity: isUrgent ? 'CRITICAL' : 'WARNING',
          severityWeight: isUrgent ? 400 : 300,
          title: `Official Coverage Gap (${c.courtName})`,
          description: `Ring "${c.courtName}" (${c.state}) has no active Table Official assigned to the scoring table.`,
          targetStation: 'COURT_OPERATIONS',
          category: 'OFFICIAL',
          actionLabel: onOpenOfficialRotationModal ? 'Assign Official' : 'View Ring Operations',
          onAction: onOpenOfficialRotationModal ? onOpenOfficialRotationModal : () => onStationChange('COURT_OPERATIONS'),
        });
      }
    });

    // 4. Score Stalemate / Advantage Tie on Active Ring
    telemetry.forEach((c) => {
      if (c.activeMatch) {
        const m = c.activeMatch;
        const rScore = m.redAthlete?.score || 0;
        const bScore = m.blueAthlete?.score || 0;
        const rAdv = m.redAthlete?.advantageCount || 0;
        const bAdv = m.blueAthlete?.advantageCount || 0;
        if (rScore > 0 && rScore === bScore && rAdv === bAdv) {
          items.push({
            id: `attention-tie-${m.matchId}`,
            severity: 'WARNING',
            severityWeight: 300,
            title: `Score Arbitration Needed (Match #${m.matchNumber})`,
            description: `Match #${m.matchNumber} on ${c.courtName} is tied (${rScore}-${bScore}, Adv: ${rAdv}-${bAdv}). Referee arbitration required.`,
            targetStation: 'SCORING_DESK',
            category: 'SCORING',
            actionLabel: 'Open Scoring Desk',
            onAction: () => onStationChange('SCORING_DESK'),
          });
        }
      }
    });

    // 5. Stalled Bout (> 15 minutes LIVE duration)
    telemetry.forEach((c) => {
      if (c.activeMatch?.startedAt) {
        const m = c.activeMatch;
        let startedTs = 0;
        try {
          startedTs = Date.parse(m.startedAt || '');
        } catch {
          startedTs = 0;
        }

        if (!isNaN(startedTs) && startedTs > 0 && (Date.now() - startedTs) > 15 * 60 * 1000) {
          const durationMins = Math.floor((Date.now() - startedTs) / 60000);
          items.push({
            id: `attention-stalled-${m.matchId}`,
            severity: 'WARNING',
            severityWeight: 300,
            title: `Stalled Bout Warning (Match #${m.matchNumber})`,
            description: `Match #${m.matchNumber} on ${c.courtName} has been LIVE for ${durationMins} minutes. Check ring pacing.`,
            timestamp: startedTs,
            targetStation: 'SCORING_DESK',
            category: 'SCORING',
            actionLabel: 'Inspect Scoring Desk',
            onAction: () => onStationChange('SCORING_DESK'),
          });
        }
      }
    });

    // 6. Ring OFFLINE with Pending Queue Dispatches
    telemetry.forEach((c) => {
      if (!c.isActive && !c.activeMatch && c.assignedQueue && c.assignedQueue.length > 0) {
        items.push({
          id: `attention-offline-queue-${c.courtId}`,
          severity: 'WARNING',
          severityWeight: 300,
          title: `Offline Ring Has Queued Bouts (${c.courtName})`,
          description: `Ring "${c.courtName}" is OFFLINE but has ${c.assignedQueue.length} bouts assigned to its queue.`,
          targetStation: 'COURT_OPERATIONS',
          category: 'COURT',
          actionLabel: 'Manage Ring Operations',
          onAction: () => onStationChange('COURT_OPERATIONS'),
        });
      }
    });

    // 7. Feeder Match Blocked (waiting on upstream winner)
    (queue || []).forEach((q) => {
      if (q.queueState === 'BLOCKED') {
        items.push({
          id: `attention-blocked-${q.matchId}`,
          severity: 'INFO',
          severityWeight: 200,
          title: `Feeder Bout Blocked (Match #${q.matchNumber})`,
          description: `Match #${q.matchNumber} (${q.divisionName || 'Division'}) is waiting for upstream match results before it can be dispatched.`,
          targetStation: 'COURT_OPERATIONS',
          category: 'QUEUE',
          actionLabel: 'View Dispatch Queue',
          onAction: () => onStationChange('COURT_OPERATIONS'),
        });
      }
    });

    return items;
  }, [venueEmergencyIncidents, telemetry, queue, onStationChange, onOpenOfficialRotationModal]);

  // Deterministically sorted attention items
  const sortedAttentionItems = useMemo(() => {
    return [...attentionItems].sort((a, b) => {
      if (b.severityWeight !== a.severityWeight) {
        return b.severityWeight - a.severityWeight;
      }
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  }, [attentionItems]);

  const criticalCount = useMemo(() => attentionItems.filter((i) => i.severity === 'CRITICAL').length, [attentionItems]);
  const warningCount = useMemo(() => attentionItems.filter((i) => i.severity === 'WARNING').length, [attentionItems]);
  const infoCount = useMemo(() => attentionItems.filter((i) => i.severity === 'INFO').length, [attentionItems]);
  const totalActive = attentionItems.length;

  const displayAttentionItems = useMemo(() => {
    if (severityFilter === 'ALL') return sortedAttentionItems;
    return sortedAttentionItems.filter((i) => i.severity === severityFilter);
  }, [sortedAttentionItems, severityFilter]);

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Banner: Tournament Context & Real-Time Telemetry Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-3.5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
          <div className="flex items-center space-x-3 sm:space-x-3.5 min-w-0">
            <div className="p-2.5 sm:p-3 bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-xl sm:rounded-2xl shrink-0">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-1.5 sm:space-x-2 flex-wrap gap-y-1">
                <h1 className="text-base sm:text-xl font-bold text-white tracking-tight break-words">
                  Tournament Day Command Center
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold shrink-0">
                  P7-04 LIVE CONTROL
                </span>
                {snapshot ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono shrink-0">
                    SNAPSHOT v{snapshot.version} ACTIVE
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-mono shrink-0">
                    LIVE REPOSITORY
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Centralized 6-station operational command, real-time arena dispatch, score arbitration &amp; recovery ledger.
              </p>
            </div>
          </div>

          {/* Controls: Tournament Selector, Officials Modal, Refresh & Telemetry Pill */}
          <div className="flex items-center flex-wrap gap-2 sm:gap-2.5 w-full md:w-auto min-w-0">
            {tournaments.length > 0 && (
              <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 sm:px-3 py-1.5 min-w-0 max-w-full flex-1 sm:flex-initial">
                <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
                <select
                  value={selectedTournamentId}
                  onChange={(e) => onTournamentChange(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer w-full sm:w-auto sm:max-w-xs md:max-w-sm truncate"
                >
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                      {t.name} ({t.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {canManage && onOpenOfficialRotationModal && (
              <button
                type="button"
                onClick={onOpenOfficialRotationModal}
                disabled={!selectedTournamentId}
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 rounded-xl border border-indigo-500/30 transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 min-h-[38px] sm:min-h-[40px]"
                title="Manage Event Officials & Batch Shift Rotation (P7-03C / P7-03D)"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden xs:inline sm:inline">Officials &amp; Shifts</span>
              </button>
            )}

            {/* In-App Operator SOP Reference Drawer Trigger */}
            <button
              type="button"
              onClick={() => setIsSopDrawerOpen(true)}
              className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 hover:text-amber-300 rounded-xl border border-amber-500/30 transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm min-h-[38px] sm:min-h-[40px]"
              title="Open Operator SOP Runbook & Error Reference Guide (P9-02A)"
              aria-label="Open Operator Standard Operating Procedures Reference Guide"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden xs:inline sm:inline">SOP Guide</span>
            </button>

            {/* Connection & Telemetry Status Pill */}
            <div className="flex items-center space-x-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] sm:text-[11px] font-mono">
              {!isOnline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400 font-bold">OFFLINE</span>
                </>
              ) : isReconnecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span className="text-amber-400 font-bold">SYNCING</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-emerald-400 font-bold">LIVE</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading || !selectedTournamentId}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-all disabled:opacity-50 min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] flex items-center justify-center"
              title="Force Sync Telemetry & Queue"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Real-time Telemetry Summary Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3 mt-3.5 sm:mt-5 pt-3.5 sm:pt-5 border-t border-slate-800/80">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Active Rings</span>
              <div className="text-base sm:text-lg font-bold text-white font-mono mt-0.5">
                {metrics.activeCourts} <span className="text-xs text-slate-500 font-normal">/ {metrics.totalCourts}</span>
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Live Bouts</span>
              <div className="text-base sm:text-lg font-bold text-rose-400 font-mono mt-0.5 flex items-center space-x-1.5">
                <span>{metrics.liveMatchesCount}</span>
                {metrics.liveMatchesCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                )}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">On-Deck Queue</span>
              <div className="text-base sm:text-lg font-bold text-amber-400 font-mono mt-0.5">
                {metrics.assignedQueueCount + metrics.readyQueueCount}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 sm:p-3">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Completed Bouts</span>
              <div className="text-base sm:text-lg font-bold text-emerald-400 font-mono mt-0.5">
                {metrics.completedMatchesCount}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 sm:p-3 col-span-2 sm:col-span-4 lg:col-span-1 flex flex-col justify-between">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Telemetry Sync</span>
              <div className="text-xs font-mono text-slate-300 mt-1 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : 'Pending'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 1. TOP-TIER VENUE-WIDE EMERGENCY ARENA STOPPAGE ALERT (Authoritative Audit Ledger) */}
      {venueEmergencyIncidents.length > 0 && (
        <div className="space-y-3">
          {venueEmergencyIncidents.map((incident) => {
            const notes = incident.details?.notes || incident.details?.reason || incident.details?.description;
            const actorName = incident.actor_profile?.full_name || incident.actor_role || 'Tournament Command';
            const entityContext = incident.entity_type
              ? `${incident.entity_type}${incident.entity_id ? ` #${incident.entity_id.slice(0, 8)}` : ''}`
              : 'Arena Floor';

            return (
              <div
                key={incident.id}
                className="bg-rose-950/95 border-2 border-rose-500 rounded-2xl p-4 sm:p-5 shadow-2xl relative overflow-hidden text-rose-100 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-pulse"
              >
                <div className="flex items-start sm:items-center space-x-3.5 flex-1">
                  <div className="p-3 bg-rose-600/30 border border-rose-500 text-rose-300 rounded-2xl shrink-0">
                    <Flame className="w-6 h-6 animate-bounce" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-rose-600 text-white font-extrabold text-[10px] tracking-wider rounded-md uppercase font-mono shadow-sm">
                        VENUE-WIDE EMERGENCY ALERT
                      </span>
                      <span className="text-xs font-mono font-bold text-rose-300">
                        {incident.action}
                      </span>
                      <span className="text-[10px] text-rose-400 font-mono">
                        {new Date(incident.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                      {notes || `Active arena emergency stoppage logged on ${entityContext}.`}
                    </h3>
                    <p className="text-xs text-rose-300/90">
                      Logged by: <span className="font-semibold text-white">{actorName}</span> | Target: <span className="font-mono font-semibold text-rose-200">{entityContext}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStationChange('INCIDENT_RECOVERY')}
                    className="px-4 py-2 bg-white hover:bg-rose-50 text-rose-950 font-bold text-xs rounded-xl shadow-lg flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap min-h-[40px]"
                  >
                    <ShieldAlert className="w-4 h-4 text-rose-700" />
                    <span>Open Incident Recovery</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. UNIFIED ATTENTION & EXCEPTION CENTER (P22.24-C) */}
      {totalActive === 0 ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 sm:p-3.5 flex items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-center space-x-2.5 text-emerald-400">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
            <span className="font-semibold text-[11px] sm:text-xs">
              {isLoading && telemetry.length === 0
                ? 'Synchronizing Arena Telemetry...'
                : '0 Active Issues — Arena Operational & All Systems Nominal'}
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-mono">
            STATUS: NOMINAL
          </span>
        </div>
      ) : (
        <div
          className={`rounded-xl border transition-all shadow-md overflow-hidden ${
            criticalCount > 0
              ? 'bg-slate-900/95 border-rose-500/40'
              : warningCount > 0
              ? 'bg-slate-900/95 border-amber-500/40'
              : 'bg-slate-900/95 border-slate-800'
          }`}
        >
          {/* Summary Trigger Bar */}
          <button
            type="button"
            onClick={() => setIsAttentionOpen((prev) => !prev)}
            aria-expanded={isAttentionOpen}
            aria-controls="attention-center-drawer"
            className="w-full p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-left cursor-pointer hover:bg-slate-800/40 transition-all min-h-[40px]"
          >
            <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
              <div
                className={`p-1.5 rounded-lg shrink-0 ${
                  criticalCount > 0
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : warningCount > 0
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span className="text-xs sm:text-sm font-bold text-white tracking-tight">
                    Attention Center: {totalActive} Active {totalActive === 1 ? 'Issue' : 'Issues'}
                  </span>
                  <div className="flex items-center space-x-1.5 font-mono text-[10px]">
                    {criticalCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                        {criticalCount} Critical
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                        {warningCount} Warnings
                      </span>
                    )}
                    {infoCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                        {infoCount} Info
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">
                  {isAttentionOpen
                    ? 'Click to collapse operational attention ledger'
                    : 'Click to inspect consolidated exceptions and quick-navigate'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 shrink-0 self-end sm:self-auto">
              <span className="text-[11px] text-amber-400 hover:text-amber-300">
                {isAttentionOpen ? 'Hide Attention Center' : 'Inspect Issues'}
              </span>
              {isAttentionOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </div>
          </button>

          {/* Expandable Attention Drawer */}
          {isAttentionOpen && (
            <div id="attention-center-drawer" className="border-t border-slate-800/80 p-3 sm:p-4 space-y-3 bg-slate-950/70">
              {/* Severity Filter Tabs */}
              <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 pb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
                  <Filter className="w-3 h-3" /> Filter:
                </span>
                <button
                  type="button"
                  onClick={() => setSeverityFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all min-h-[36px] sm:min-h-0 ${
                    severityFilter === 'ALL'
                      ? 'bg-amber-500 text-slate-950 font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  All ({totalActive})
                </button>
                {criticalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSeverityFilter('CRITICAL')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all min-h-[36px] sm:min-h-0 ${
                      severityFilter === 'CRITICAL'
                        ? 'bg-rose-600 text-white font-extrabold'
                        : 'bg-slate-900 text-rose-300 hover:text-rose-200 border border-rose-900/50'
                    }`}
                  >
                    Critical ({criticalCount})
                  </button>
                )}
                {warningCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSeverityFilter('WARNING')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all min-h-[36px] sm:min-h-0 ${
                      severityFilter === 'WARNING'
                        ? 'bg-amber-600 text-white font-extrabold'
                        : 'bg-slate-900 text-amber-300 hover:text-amber-200 border border-amber-900/50'
                    }`}
                  >
                    Warnings ({warningCount})
                  </button>
                )}
                {infoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSeverityFilter('INFO')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all min-h-[36px] sm:min-h-0 ${
                      severityFilter === 'INFO'
                        ? 'bg-slate-700 text-white font-extrabold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    Info ({infoCount})
                  </button>
                )}
              </div>

              {/* Items List */}
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {displayAttentionItems.map((item) => {
                  const isCrit = item.severity === 'CRITICAL';
                  const isWarn = item.severity === 'WARNING';

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-all ${
                        isCrit
                          ? 'bg-rose-950/40 border-rose-800/80 text-rose-100'
                          : isWarn
                          ? 'bg-amber-950/30 border-amber-800/70 text-amber-100'
                          : 'bg-slate-900/60 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                              isCrit
                                ? 'bg-rose-600 text-white'
                                : isWarn
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {item.severity}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700 text-[9px] font-mono text-slate-300">
                            {item.category}
                          </span>
                          {item.timestamp && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-white text-xs sm:text-sm tracking-tight break-words">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-slate-300/90 break-words">
                          {item.description}
                        </p>
                      </div>

                      <div className="flex items-center shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={item.onAction}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-all min-h-[40px] shadow-xs cursor-pointer ${
                            isCrit
                              ? 'bg-rose-600 hover:bg-rose-500 text-white'
                              : isWarn
                              ? 'bg-amber-600 hover:bg-amber-500 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                          }`}
                        >
                          <span>{item.actionLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Message Notice */}
      {errorMessage && (
        <div className="p-3.5 sm:p-4 bg-rose-950/50 border border-rose-800/80 rounded-xl flex items-center space-x-3 text-xs text-rose-300">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 6-Station Navigation Tabs */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 border-b border-slate-800 pb-2 sm:pb-3 overflow-x-auto">
        {(Object.keys(OPERATIONAL_STATIONS_METADATA) as OperationalStationId[]).map((stationId) => {
          const meta = OPERATIONAL_STATIONS_METADATA[stationId];
          const Icon = STATION_ICONS[stationId] || Radio;
          const isActive = activeStation === stationId;

          // Badging for items in station
          let stationCount: string | number | null = null;
          if (stationId === 'COURT_OPERATIONS') {
            stationCount = telemetry.length;
          } else if (stationId === 'SCORING_DESK') {
            stationCount = metrics ? metrics.liveMatchesCount : null;
          } else if (stationId === 'REGISTRATION_WEIGHIN') {
            stationCount = null;
          } else if (stationId === 'INCIDENT_RECOVERY') {
            const totalAlerts = attentionItems.length;
            stationCount = totalAlerts > 0 ? totalAlerts : null;
          }

          return (
            <button
              key={stationId}
              type="button"
              onClick={() => onStationChange(stationId)}
              className={`px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center space-x-1.5 sm:space-x-2 shrink-0 min-h-[38px] sm:min-h-[42px] ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400/20 font-extrabold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
              <span>{meta.shortLabel}</span>
              {stationCount !== null && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold ${
                    isActive
                      ? 'bg-slate-950/20 text-slate-950'
                      : stationId === 'INCIDENT_RECOVERY' && (venueEmergencyIncidents.length > 0 || criticalCount > 0)
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {stationCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Station Active Panel */}
      <div className="space-y-6">{children}</div>

      {/* In-App Operator Standard Operating Procedures Drawer (P9-02A) */}
      <CommandCenterSopDrawer
        isOpen={isSopDrawerOpen}
        onClose={() => setIsSopDrawerOpen(false)}
        activeStation={activeStation}
      />
    </div>
  );
};
