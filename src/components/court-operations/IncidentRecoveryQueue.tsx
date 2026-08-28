import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Shield,
  Layers,
  ChevronRight,
  Info,
  Radio,
  XCircle,
  RotateCcw,
  Sliders,
  Check,
  AlertCircle,
  Database,
  ArrowRight,
  FileText,
  Activity,
  Award,
  Tv,
  Users,
  Lock,
  Loader2,
  ExternalLink,
  ChevronDown,
  PlusCircle
} from 'lucide-react';
import {
  CourtTelemetry,
  EnrichedQueueMatch,
  IncidentItem,
  IncidentSeverity,
  IncidentCategory,
  SystemAuditLogEntry
} from '../../types/courtOperations';
import { Tournament, TournamentSnapshot, DecisionType } from '../../types/tournament';
import { courtOperationsService } from '../../services/courtOperationsService';
import { scoringService } from '../../services/scoringService';
import { formatRpcError } from '../../utils/rpcErrorFormatter';
import { DestructiveActionGuardModal } from '../common/DestructiveActionGuardModal';

interface IncidentRecoveryQueueProps {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  telemetry: CourtTelemetry[];
  queue: EnrichedQueueMatch[];
  canManage: boolean;
  canScore: boolean;
  onOpenScoringConsole: (matchId: string, assignmentId: string) => void;
  onRefresh?: () => void;
}

export type IncidentTab = 'INCIDENTS' | 'RINGS' | 'AUDIT_LOGS' | 'PROTOCOLS';
export type IncidentCategoryFilter = 'ALL' | 'ATTENTION' | 'COURT_OFFLINE' | 'SCORE_TIE' | 'STALLED' | 'BLOCKED';

export const IncidentRecoveryQueue: React.FC<IncidentRecoveryQueueProps> = ({
  tournament,
  snapshot,
  telemetry,
  queue,
  canManage,
  canScore,
  onOpenScoringConsole,
  onRefresh
}) => {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<IncidentTab>('INCIDENTS');
  const [categoryFilter, setCategoryFilter] = useState<IncidentCategoryFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventFilter, setEventFilter] = useState<string>('ALL');

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<SystemAuditLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());

  // Action / Modal states
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);

  // Cancellation Modal
  const [cancelModalMatch, setCancelModalMatch] = useState<{
    matchId: string;
    assignmentId: string;
    matchNumber: number;
    eventName: string;
    courtName?: string;
  } | null>(null);

  // Emergency Match Resolution / Disqualification / Forfeit Modal
  const [resolutionModalMatch, setResolutionModalMatch] = useState<{
    matchId: string;
    matchNumber: number;
    eventName: string;
    roundName: string;
    redRegistrationId?: string;
    blueRegistrationId?: string;
    redAthleteName?: string;
    blueAthleteName?: string;
  } | null>(null);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string>('');
  const [selectedDecisionType, setSelectedDecisionType] = useState<DecisionType>('DQ');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [isResolutionGuardOpen, setIsResolutionGuardOpen] = useState<boolean>(false);

  // Ring Toggle Confirmation Modal
  const [ringToggleTarget, setRingToggleTarget] = useState<CourtTelemetry | null>(null);

  // Manual Incident Logging Modal
  const [isLogIncidentModalOpen, setIsLogIncidentModalOpen] = useState<boolean>(false);
  const [manualAction, setManualAction] = useState<string>('EQUIPMENT_MALFUNCTION');
  const [manualSeverity, setManualSeverity] = useState<IncidentSeverity>('WARNING');
  const [manualCourtId, setManualCourtId] = useState<string>('');
  const [manualMatchId, setManualMatchId] = useState<string>('');
  const [manualNotes, setManualNotes] = useState<string>('');

  // Load audit logs
  const loadAuditLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const logs = await courtOperationsService.fetchTournamentAuditLogs(tournament.id, 60);
      setAuditLogs(logs);
      setLastSyncTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.warn('Could not load audit logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [tournament.id]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  // Derive unique events for filtering
  const uniqueEvents = useMemo(() => {
    const map = new Map<string, string>();
    queue.forEach(q => {
      if (q.eventId && q.eventName) map.set(q.eventId, q.eventName);
    });
    telemetry.forEach(t => {
      if (t.activeMatch?.eventId && t.activeMatch?.eventName) {
        map.set(t.activeMatch.eventId, t.activeMatch.eventName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [queue, telemetry]);

  // Derived Incident & Anomaly Detection (Presentation-Only Priority)
  const incidentItems = useMemo<IncidentItem[]>(() => {
    const items: IncidentItem[] = [];

    // 1. Offline courts with assigned or live matches
    telemetry.forEach(court => {
      if (!court.isActive) {
        if (court.activeMatch) {
          items.push({
            id: `court-offline-live-${court.courtId}`,
            category: 'COURT_OFFLINE',
            severity: 'CRITICAL',
            title: `Court ${court.courtName} Offline With Live Match`,
            description: `Court is set to OFFLINE / PAUSED, but Match #${court.activeMatch.matchNumber} is currently assigned as LIVE.`,
            courtId: court.courtId,
            courtName: court.courtName,
            courtIdentifier: court.courtIdentifier,
            matchId: court.activeMatch.matchId,
            matchNumber: court.activeMatch.matchNumber,
            assignmentId: court.activeMatch.assignmentId,
            eventId: court.activeMatch.eventId,
            eventName: court.activeMatch.eventName,
            redAthleteName: court.activeMatch.redAthlete?.athleteName,
            blueAthleteName: court.activeMatch.blueAthlete?.athleteName,
            timestamp: court.activeMatch.startedAt || new Date().toISOString(),
            actionRequired: 'Resume court online status or cancel dispatch assignment to clear the ring.',
          });
        } else if (court.assignedQueue.length > 0) {
          items.push({
            id: `court-offline-queue-${court.courtId}`,
            category: 'COURT_OFFLINE',
            severity: 'WARNING',
            title: `Court ${court.courtName} Offline With ${court.assignedQueue.length} Queued Bout(s)`,
            description: `Court has queued dispatches waiting but court is set to OFFLINE / PAUSED.`,
            courtId: court.courtId,
            courtName: court.courtName,
            courtIdentifier: court.courtIdentifier,
            timestamp: new Date().toISOString(),
            actionRequired: 'Reactivate court or reassign queued bouts to available rings.',
          });
        }
      }
    });

    // 2. Telemetry Scoring Stalemate / Ties
    telemetry.forEach(court => {
      if (court.activeMatch) {
        const m = court.activeMatch;
        const redScore = m.redAthlete?.score || 0;
        const blueScore = m.blueAthlete?.score || 0;
        const redAdv = m.redAthlete?.advantageCount || 0;
        const blueAdv = m.blueAthlete?.advantageCount || 0;

        if (redScore > 0 && redScore === blueScore && redAdv === blueAdv) {
          items.push({
            id: `score-tie-${m.matchId}`,
            category: 'SCORE_TIE_STALEMATE',
            severity: 'WARNING',
            title: `Match #${m.matchNumber} Tied Score (${redScore} - ${blueScore})`,
            description: `Bout on ${court.courtName} has equal scores and equal advantage counts. Chief referee arbitration required if regular rounds conclude tied.`,
            courtId: court.courtId,
            courtName: court.courtName,
            courtIdentifier: court.courtIdentifier,
            matchId: m.matchId,
            matchNumber: m.matchNumber,
            assignmentId: m.assignmentId,
            eventId: m.eventId,
            eventName: m.eventName,
            redAthleteName: m.redAthlete?.athleteName,
            blueAthleteName: m.blueAthlete?.athleteName,
            timestamp: m.startedAt || new Date().toISOString(),
            actionRequired: 'Open scoring console for chief referee tie-break review or advantage confirmation.',
          });
        }
      }
    });

    // 3. Queue Blockages & Dependencies
    queue.forEach(q => {
      if (q.queueState === 'BLOCKED') {
        items.push({
          id: `queue-blocked-${q.matchId}`,
          category: 'QUEUE_BLOCKED',
          severity: 'INFO',
          title: `Match #${q.matchNumber} Awaiting Feeder Bracket Progression`,
          description: `Bout in ${q.eventName} (${q.roundName}) is awaiting upstream winner determinations before fighters can be dispatched.`,
          matchId: q.matchId,
          matchNumber: q.matchNumber,
          eventId: q.eventId,
          eventName: q.eventName,
          timestamp: new Date().toISOString(),
          actionRequired: 'Complete prerequisite feeder matches in the tournament bracket.',
        });
      }
    });

    // 4. Stalled live matches (assigned for over 15 minutes or no active scoring)
    telemetry.forEach(court => {
      if (court.activeMatch) {
        const startedAt = court.activeMatch.startedAt;
        if (startedAt) {
          const durationMinutes = (Date.now() - new Date(startedAt).getTime()) / (1000 * 60);
          if (durationMinutes > 15) {
            items.push({
              id: `stalled-bout-${court.activeMatch.matchId}`,
              category: 'STALLED_BOUT',
              severity: 'WARNING',
              title: `Match #${court.activeMatch.matchNumber} In-Progress > 15 Minutes`,
              description: `Bout on ${court.courtName} has been LIVE for ${Math.round(durationMinutes)} min. Verify if match is stalled due to injury, equipment timeout, or scoring console freeze.`,
              courtId: court.courtId,
              courtName: court.courtName,
              matchId: court.activeMatch.matchId,
              matchNumber: court.activeMatch.matchNumber,
              assignmentId: court.activeMatch.assignmentId,
              eventId: court.activeMatch.eventId,
              eventName: court.activeMatch.eventName,
              redAthleteName: court.activeMatch.redAthlete?.athleteName,
              blueAthleteName: court.activeMatch.blueAthlete?.athleteName,
              timestamp: startedAt,
              actionRequired: 'Check with Table Official or verify ring status.',
            });
          }
        }
      }
    });

    // 5. Official Staffing & Coverage Gaps (Active operational rings with missing Table Official)
    telemetry.forEach(court => {
      // Only evaluate operational rings eligible for competition (active and not offline)
      if (!court.isActive || court.state === 'OFFLINE') return;

      const hasTableOfficial = (court.assignedOfficials || []).some(
        off => off.role === 'TABLE_OFFICIAL' && (off.courtId === court.courtId || off.courtId === null)
      );

      if (!hasTableOfficial) {
        const isBoutAffected = court.state === 'LIVE' || court.state === 'ASSIGNED' || !!court.activeMatch;
        items.push({
          id: `coverage-table-official-${court.courtId}`,
          category: 'DISPATCH_ANOMALY',
          severity: isBoutAffected ? 'CRITICAL' : 'WARNING',
          title: `Court ${court.courtName} Missing Table Official`,
          description: isBoutAffected
            ? `Court ${court.courtName} is in ${court.state} state with an active or assigned bout, but has no active Table Official assigned for scorekeeping.`
            : `Court ${court.courtName} is active for competition but has no active Table Official assigned. Official coverage is required before starting or scoring bouts.`,
          courtId: court.courtId,
          courtName: court.courtName,
          courtIdentifier: court.courtIdentifier,
          matchId: court.activeMatch?.matchId,
          matchNumber: court.activeMatch?.matchNumber,
          assignmentId: court.activeMatch?.assignmentId,
          eventId: court.activeMatch?.eventId,
          eventName: court.activeMatch?.eventName,
          timestamp: new Date().toISOString(),
          actionRequired: 'Assign a qualified Table Official to this court in Event Assignments to ensure scoring readiness.',
        });
      }
    });

    return items;
  }, [telemetry, queue]);

  // Filtered Incident Items
  const filteredIncidents = useMemo(() => {
    return incidentItems.filter(item => {
      // Category filter
      if (categoryFilter === 'ATTENTION' && item.severity === 'INFO') return false;
      if (categoryFilter === 'COURT_OFFLINE' && item.category !== 'COURT_OFFLINE') return false;
      if (categoryFilter === 'SCORE_TIE' && item.category !== 'SCORE_TIE_STALEMATE') return false;
      if (categoryFilter === 'STALLED' && item.category !== 'STALLED_BOUT') return false;
      if (categoryFilter === 'BLOCKED' && item.category !== 'QUEUE_BLOCKED') return false;

      // Event filter
      if (eventFilter !== 'ALL' && item.eventId !== eventFilter) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesDesc = item.description.toLowerCase().includes(query);
        const matchesCourt = item.courtName?.toLowerCase().includes(query);
        const matchesRed = item.redAthleteName?.toLowerCase().includes(query);
        const matchesBlue = item.blueAthleteName?.toLowerCase().includes(query);
        const matchesMatchNum = item.matchNumber?.toString().includes(query);
        if (!matchesTitle && !matchesDesc && !matchesCourt && !matchesRed && !matchesBlue && !matchesMatchNum) {
          return false;
        }
      }

      return true;
    });
  }, [incidentItems, categoryFilter, eventFilter, searchQuery]);

  // Filtered Audit Logs
  const filteredLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesAction = log.action.toLowerCase().includes(query);
        const matchesActor = (log.actor_profile?.full_name || log.actor_role || '').toLowerCase().includes(query);
        const matchesDetails = JSON.stringify(log.details || {}).toLowerCase().includes(query);
        if (!matchesAction && !matchesActor && !matchesDetails) return false;
      }
      return true;
    });
  }, [auditLogs, searchQuery]);

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const totalCourts = telemetry.length;
    const offlineCourts = telemetry.filter(c => !c.isActive).length;
    const criticalIncidents = incidentItems.filter(i => i.severity === 'CRITICAL').length;
    const warningIncidents = incidentItems.filter(i => i.severity === 'WARNING').length;
    const liveMatches = telemetry.filter(c => c.activeMatch).length;
    const blockedMatches = queue.filter(q => q.queueState === 'BLOCKED').length;

    return {
      totalCourts,
      offlineCourts,
      criticalIncidents,
      warningIncidents,
      liveMatches,
      blockedMatches,
      totalIncidents: incidentItems.length
    };
  }, [telemetry, incidentItems, queue]);

  // Handler: Log Manual Incident Report
  const handleExecuteLogManualIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAction.trim()) return;

    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      await courtOperationsService.logTournamentIncident({
        tournamentId: tournament.id,
        action: manualAction.trim(),
        severity: manualSeverity,
        entityType: manualMatchId ? 'MATCH' : (manualCourtId ? 'COURT' : 'INCIDENT'),
        entityId: manualMatchId || manualCourtId || undefined,
        details: {
          notes: manualNotes.trim(),
          court_id: manualCourtId || null,
          match_id: manualMatchId || null,
          reported_timestamp: new Date().toISOString()
        }
      });

      setActionSuccess(`Operational incident '${manualAction}' recorded to tournament audit ledger.`);
      setIsLogIncidentModalOpen(false);
      setManualNotes('');
      setManualCourtId('');
      setManualMatchId('');
      loadAuditLogs();
    } catch (err: any) {
      setActionError(formatRpcError(err));
    } finally {
      setIsActionPending(false);
    }
  };

  // Handler: Cancel Match Assignment
  const handleExecuteCancelDispatch = async (reasonText?: string) => {
    if (!cancelModalMatch) return;
    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const finalReason = (reasonText || 'Incident Recovery Reassignment').trim();

    try {
      await courtOperationsService.cancelDispatch(cancelModalMatch.assignmentId, finalReason);
      
      // Also log structured tournament incident
      try {
        await courtOperationsService.logTournamentIncident({
          tournamentId: tournament.id,
          action: 'CANCEL_MATCH_ASSIGNMENT',
          severity: 'WARNING',
          entityType: 'COURT_ASSIGNMENT',
          entityId: cancelModalMatch.assignmentId,
          details: {
            match_id: cancelModalMatch.matchId,
            match_number: cancelModalMatch.matchNumber,
            event_name: cancelModalMatch.eventName,
            court_name: cancelModalMatch.courtName,
            reason: finalReason
          }
        });
      } catch (logErr) {
        console.warn('Incident log recording warning:', logErr);
      }

      setActionSuccess(`Match #${cancelModalMatch.matchNumber} assignment successfully cancelled and returned to the ready queue.`);
      setCancelModalMatch(null);
      if (onRefresh) onRefresh();
      loadAuditLogs();
    } catch (err: any) {
      setActionError(formatRpcError(err));
      // Stale-state conflict safety: trigger non-mutating telemetry resync without replaying mutation
      if (onRefresh) onRefresh();
    } finally {
      setIsActionPending(false);
    }
  };

  // Handler: Emergency Complete / Disqualification / Forfeit
  const handleExecuteResolution = async (reasonText?: string) => {
    if (!resolutionModalMatch || !selectedWinnerId) {
      setActionError('Please select the winning participant to resolve this bout.');
      return;
    }

    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const finalNotes = (reasonText || resolutionNotes || '').trim();

    try {
      await scoringService.completeCourtMatch(
        resolutionModalMatch.matchId,
        selectedWinnerId,
        selectedDecisionType
      );

      // Also log structured emergency arbitration incident
      try {
        await courtOperationsService.logTournamentIncident({
          tournamentId: tournament.id,
          action: `EMERGENCY_RESOLUTION_${selectedDecisionType}`,
          severity: 'CRITICAL',
          entityType: 'MATCH',
          entityId: resolutionModalMatch.matchId,
          details: {
            match_number: resolutionModalMatch.matchNumber,
            event_name: resolutionModalMatch.eventName,
            decision_type: selectedDecisionType,
            winner_registration_id: selectedWinnerId,
            notes: finalNotes
          }
        });
      } catch (logErr) {
        console.warn('Incident log recording warning:', logErr);
      }

      setActionSuccess(
        `Match #${resolutionModalMatch.matchNumber} successfully finalized with decision type: ${selectedDecisionType}. Winner advanced in bracket progression.`
      );
      setIsResolutionGuardOpen(false);
      setResolutionModalMatch(null);
      setSelectedWinnerId('');
      setResolutionNotes('');
      if (onRefresh) onRefresh();
      loadAuditLogs();
    } catch (err: any) {
      setActionError(formatRpcError(err));
      // Stale-state conflict safety: trigger non-mutating telemetry resync without replaying mutation
      if (onRefresh) onRefresh();
    } finally {
      setIsActionPending(false);
    }
  };

  // Handler: Toggle Court Active Status
  const handleExecuteToggleCourt = async (reasonText?: string) => {
    if (!ringToggleTarget) return;
    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const newStatus = !ringToggleTarget.isActive;
    const finalReason = (reasonText || '').trim();

    try {
      await courtOperationsService.setCourtActiveStatus(ringToggleTarget.courtId, newStatus);

      // Also log structured court status change incident
      try {
        await courtOperationsService.logTournamentIncident({
          tournamentId: tournament.id,
          action: newStatus ? 'COURT_ACTIVATED' : 'COURT_PAUSED_OFFLINE',
          severity: newStatus ? 'INFO' : 'WARNING',
          entityType: 'COURT',
          entityId: ringToggleTarget.courtId,
          details: {
            court_name: ringToggleTarget.courtName,
            is_active: newStatus,
            reason: finalReason
          }
        });
      } catch (logErr) {
        console.warn('Incident log recording warning:', logErr);
      }

      setActionSuccess(`Court ${ringToggleTarget.courtName} status changed to ${newStatus ? 'ONLINE' : 'OFFLINE / PAUSED'}.`);
      setRingToggleTarget(null);
      if (onRefresh) onRefresh();
      loadAuditLogs();
    } catch (err: any) {
      setActionError(formatRpcError(err));
      // Stale-state conflict safety: trigger non-mutating telemetry resync without replaying mutation
      if (onRefresh) onRefresh();
    } finally {
      setIsActionPending(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 1. Header & Context Banner */}
      <div className="p-3 sm:p-4 lg:p-5 bg-linear-to-r from-rose-500/10 via-rose-500/5 to-transparent border border-rose-300 dark:border-rose-500/30 rounded-xl space-y-2.5 sm:space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 sm:p-2.5 bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400 rounded-xl shrink-0">
              <ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Incident &amp; Emergency Recovery Station
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                  DISPUTE &amp; RECOVERY OVERSIGHT
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
                Arbitration reference, ring safety monitoring, and emergency recovery actions. Resolves match queue disruptions according to official protocol.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLogIncidentModalOpen(true)}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 transition-colors shadow-xs min-h-[36px] sm:min-h-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Log Incident</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (onRefresh) onRefresh();
                loadAuditLogs();
              }}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors shadow-xs min-h-[36px] sm:min-h-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Presentation Invariant Notice */}
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-rose-800 dark:text-rose-300/90 bg-rose-50 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200 dark:border-rose-900/50">
          <Info className="w-4 h-4 flex-shrink-0 text-rose-600 dark:text-rose-400" />
          <span>
            <strong>Operational Attention Priority:</strong> Derived for rapid tournament day intervention. Emergency actions execute authoritative PostgreSQL SECURITY DEFINER RPCs with strict RBAC enforcement.
          </span>
        </div>
      </div>

      {/* Global Action Notifications */}
      {actionError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-lg flex items-center justify-between text-xs text-rose-800 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-rose-600 hover:underline">Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded-lg flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* 2. KPI / Telemetry Health Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <div className="p-2.5 sm:p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider">Attention</span>
            <span className={`px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold ${
              metrics.criticalIncidents > 0 
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' 
                : metrics.warningIncidents > 0
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              {metrics.criticalIncidents > 0 ? 'CRITICAL' : metrics.warningIncidents > 0 ? 'WARNING' : 'HEALTHY'}
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.totalIncidents}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            {metrics.criticalIncidents} crit, {metrics.warningIncidents} review
          </div>
        </div>

        <div className="p-2.5 sm:p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ring Health</span>
            <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.totalCourts - metrics.offlineCourts} / {metrics.totalCourts}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            {metrics.offlineCourts > 0 ? `${metrics.offlineCourts} offline` : 'All rings active'}
          </div>
        </div>

        <div className="p-2.5 sm:p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider">Live Bouts</span>
            <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.liveMatches}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            Active scoring telemetry
          </div>
        </div>

        <div className="p-2.5 sm:p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider">Blockages</span>
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-500" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.blockedMatches}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            Awaiting feeder bouts
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 gap-1.5 sm:gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('INCIDENTS')}
          className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-h-[36px] ${
            activeTab === 'INCIDENTS'
              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500" />
          <span>Attention Queue ({filteredIncidents.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('RINGS')}
          className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-h-[36px] ${
            activeTab === 'RINGS'
              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500" />
          <span>Ring Status &amp; Safety ({telemetry.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('AUDIT_LOGS')}
          className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-h-[36px] ${
            activeTab === 'AUDIT_LOGS'
              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500" />
          <span>Audit Ledger ({auditLogs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('PROTOCOLS')}
          className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-h-[36px] ${
            activeTab === 'PROTOCOLS'
              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500" />
          <span>Protocols Reference</span>
        </button>
      </div>

      {/* 4. Filter Toolbar */}
      {(activeTab === 'INCIDENTS' || activeTab === 'AUDIT_LOGS') && (
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={activeTab === 'INCIDENTS' ? "Search incident, match #, court, athlete..." : "Search action, actor, details..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-rose-500"
              />
            </div>

            {activeTab === 'INCIDENTS' && uniqueEvents.length > 0 && (
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-1 focus:ring-rose-500 max-w-[180px] truncate"
              >
                <option value="ALL">All Events</option>
                {uniqueEvents.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
          </div>

          {activeTab === 'INCIDENTS' && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {(['ALL', 'ATTENTION', 'COURT_OFFLINE', 'SCORE_TIE', 'STALLED', 'BLOCKED'] as IncidentCategoryFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCategoryFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                    categoryFilter === f
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {f === 'ALL' && 'All Issues'}
                  {f === 'ATTENTION' && 'Attention Only'}
                  {f === 'COURT_OFFLINE' && 'Ring Offline'}
                  {f === 'SCORE_TIE' && 'Score Ties'}
                  {f === 'STALLED' && 'Stalled Bouts'}
                  {f === 'BLOCKED' && 'Blocked Feeder'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. TAB 1: ATTENTION QUEUE VIEW */}
      {activeTab === 'INCIDENTS' && (
        <div className="space-y-3">
          {filteredIncidents.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                No Active Incidents or Operational Anomalies
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                All competition courts are operating normally. Scoring telemetry and match progression are running smoothly across all rings.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
              {filteredIncidents.map(item => (
                <div
                  key={item.id}
                  className={`p-3 sm:p-4 bg-white dark:bg-slate-900 border rounded-xl shadow-xs space-y-2.5 sm:space-y-3 transition-all ${
                    item.severity === 'CRITICAL'
                      ? 'border-rose-300 dark:border-rose-800/80 bg-rose-500/5'
                      : item.severity === 'WARNING'
                      ? 'border-amber-300 dark:border-amber-800/80 bg-amber-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      <div className={`p-1.5 sm:p-2 rounded-lg mt-0.5 ${
                        item.severity === 'CRITICAL'
                          ? 'bg-rose-100 dark:bg-rose-950 text-rose-600'
                          : item.severity === 'WARNING'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-600'
                          : 'bg-blue-100 dark:bg-blue-950 text-blue-600'
                      }`}>
                        {item.severity === 'CRITICAL' && <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" />}
                        {item.severity === 'WARNING' && <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />}
                        {item.severity === 'INFO' && <Info className="w-4 h-4 sm:w-5 sm:h-5" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                            {item.title}
                          </h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.severity === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : item.severity === 'WARNING'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          }`}>
                            {item.severity}
                          </span>
                          {item.courtName && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              Court {item.courtName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    {/* Operational Action Shortcuts */}
                    <div className="flex items-center gap-1.5 sm:gap-2 self-start sm:self-center flex-wrap sm:flex-nowrap">
                      {item.matchId && item.assignmentId && (
                        <button
                          type="button"
                          onClick={() => onOpenScoringConsole(item.matchId!, item.assignmentId!)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 flex items-center gap-1 transition-colors min-h-[36px] sm:min-h-0"
                        >
                          <Tv className="w-3.5 h-3.5" />
                          Scoring Console
                        </button>
                      )}

                      {item.assignmentId && canManage && (
                        <button
                          type="button"
                          onClick={() => setCancelModalMatch({
                            matchId: item.matchId!,
                            assignmentId: item.assignmentId!,
                            matchNumber: item.matchNumber || 0,
                            eventName: item.eventName || 'Bout',
                            courtName: item.courtName
                          })}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors min-h-[36px] sm:min-h-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                          Cancel Dispatch
                        </button>
                      )}

                      {item.matchId && canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            const matchData = queue.find(q => q.matchId === item.matchId);
                            setResolutionModalMatch({
                              matchId: item.matchId!,
                              matchNumber: item.matchNumber || matchData?.matchNumber || 0,
                              eventName: item.eventName || matchData?.eventName || 'Bout',
                              roundName: matchData?.roundName || 'Round',
                              redRegistrationId: matchData?.redAthlete?.registrationId,
                              blueRegistrationId: matchData?.blueAthlete?.registrationId,
                              redAthleteName: item.redAthleteName || matchData?.redAthlete?.athleteName,
                              blueAthleteName: item.blueAthleteName || matchData?.blueAthlete?.athleteName
                            });
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 flex items-center gap-1 transition-colors min-h-[36px] sm:min-h-0"
                        >
                          <Award className="w-3.5 h-3.5" />
                          Resolve / DQ
                        </button>
                      )}
                    </div>
                  </div>

                  {item.actionRequired && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg flex items-center gap-1.5">
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span><strong>Recommended Action:</strong> {item.actionRequired}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 6. TAB 2: RINGS SAFETY & STATUS VIEW */}
      {activeTab === 'RINGS' && (
        <div className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {telemetry.map(court => (
              <div
                key={court.courtId}
                className="p-3 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5 sm:space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" style={{
                      backgroundColor: court.isActive ? '#10b981' : '#f43f5e'
                    }} />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Court {court.courtName}
                    </h4>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    court.isActive 
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' 
                      : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                  }`}>
                    {court.isActive ? 'ONLINE' : 'OFFLINE / PAUSED'}
                  </span>
                </div>

                <div className="text-xs space-y-2 text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <span>Active Match Status:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {court.activeMatch ? `Match #${court.activeMatch.matchNumber} (Live)` : 'Ring Available'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <span>Queued On-Deck:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {court.assignedQueue.length} bout(s)
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <span>Bouts Completed:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {court.completedCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Assigned Officials:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {court.assignedOfficials.length} registered
                    </span>
                  </div>
                </div>

                {/* Emergency Controls for this Ring */}
                {canManage && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRingToggleTarget(court)}
                      className={`w-full py-2 text-xs font-semibold rounded-lg border transition-colors min-h-[38px] ${
                        court.isActive
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100'
                          : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      {court.isActive ? 'Pause / Set Offline' : 'Activate / Bring Online'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. TAB 3: GOVERNANCE AUDIT LEDGER */}
      {activeTab === 'AUDIT_LOGS' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-500">
            <span>Append-only system audit entries for tournament day actions</span>
            <span>Synced at: {lastSyncTime}</span>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <Database className="w-8 h-8 text-slate-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                No Audit Log Entries Recorded
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Audit logs are recorded automatically by PostgreSQL triggers and RPCs when court dispatches, bout results, or cancellations occur.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Actor / Role</th>
                      <th className="px-4 py-3">Entity</th>
                      <th className="px-4 py-3">Details / Context</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {filteredLogs.map(log => {
                      const severity = log.details?.severity || 'INFO';
                      const notes = log.details?.notes || log.details?.reason;
                      return (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[10px]">
                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              log.action.includes('CANCEL') || log.action.includes('DQ') || log.action.includes('CRITICAL')
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                : log.action.includes('COMPLETE') || log.action.includes('RESOL')
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : log.action.includes('ASSIGN') || log.action.includes('START')
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              severity === 'CRITICAL'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : severity === 'WARNING'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                            {log.actor_profile?.full_name || log.actor_role || 'System'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[10px]">
                            {log.entity_type}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-[11px] max-w-sm">
                            {notes ? (
                              <div className="font-sans text-slate-800 dark:text-slate-200">
                                <span>{notes}</span>
                                {log.details && (
                                  <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                                    {JSON.stringify(log.details)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="font-mono text-[10px]">{JSON.stringify(log.details || {})}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 8. TAB 4: RECOVERY PROTOCOLS REFERENCE */}
      {activeTab === 'PROTOCOLS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <Shield className="w-4 h-4 text-rose-500" />
              1. Walkover &amp; Forfeit Protocol (DEFAULT)
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>If an athlete fails to report to the designated ring after 3 official calls (within 3 minutes), the chief referee declares a walkover.</li>
              <li>Execute the <strong>Resolve / DQ</strong> action, select the present competitor as the winner, and select decision type <code>DEFAULT</code>.</li>
              <li>The walkover immediately advances the present competitor to the next round of the single-elimination bracket.</li>
            </ul>
          </div>

          <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <XCircle className="w-4 h-4 text-rose-500" />
              2. Disqualification Procedure (DQ)
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>In the event of severe rule violations, unsportsmanlike conduct, or failure of mandatory safety equipment, disqualification may be issued.</li>
              <li>Declare the non-offending athlete as the winner using decision type <code>DQ</code>.</li>
              <li>All disqualifications are permanently logged in the audit ledger for post-tournament judicial review.</li>
            </ul>
          </div>

          <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <RotateCcw className="w-4 h-4 text-rose-500" />
              3. Ring Hardware Failure / Stoppage Protocol
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>If a scoring tablet or ring display disconnects, use the <strong>Pause / Set Offline</strong> toggle on that ring station.</li>
              <li>Cancel queued dispatches on the affected ring to re-route matches to available alternate rings without losing bracket progression.</li>
            </ul>
          </div>

          <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <Award className="w-4 h-4 text-rose-500" />
              4. Score Arbitration &amp; Tied Rounds
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li>If regular scoring rounds conclude in a tie, the chief referee and table official must record advantage or judge decision.</li>
              <li>Table officials submit round points; the lead referee confirms official results via the Scoring Console.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CANCEL DISPATCH (DESTRUCTIVE GUARD)                              */}
      {/* ========================================================================= */}
      <DestructiveActionGuardModal
        isOpen={!!cancelModalMatch}
        onCancel={() => setCancelModalMatch(null)}
        onConfirm={async (reason) => {
          await handleExecuteCancelDispatch(reason);
        }}
        title="Cancel Court Match Assignment"
        description="Cancel this match assignment and return the bout to the unassigned ready queue for future dispatch."
        riskTier="DESTRUCTIVE"
        targetEntityName={cancelModalMatch ? `Match #${cancelModalMatch.matchNumber} (${cancelModalMatch.eventName})` : undefined}
        consequence={cancelModalMatch ? `The assignment for Match #${cancelModalMatch.matchNumber} will be cancelled. The bout will be unassigned from ${cancelModalMatch.courtName ? `Court ${cancelModalMatch.courtName}` : 'its assigned ring'} and returned to the unassigned ready queue for future dispatch.` : undefined}
        requireReason={true}
        reasonPlaceholder="e.g. Ring Maintenance, Delayed Fighter, Queue Reordering"
        confirmButtonText="Confirm Cancellation"
      />

      {/* ========================================================================= */}
      {/* MODAL 2A: DISQUALIFICATION / FORFEIT / EMERGENCY RESOLUTION SETUP (STAGE 1) */}
      {/* ========================================================================= */}
      {resolutionModalMatch && !isResolutionGuardOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3.5 sm:p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-4 sm:p-5 space-y-3 sm:space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 bg-amber-100 dark:bg-amber-950 text-amber-600 rounded-lg">
                  <Award className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Emergency Match Resolution &amp; Arbitration
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResolutionModalMatch(null);
                  setSelectedWinnerId('');
                  setResolutionNotes('');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                &times;
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-xs space-y-1">
              <div><strong>Match:</strong> #{resolutionModalMatch.matchNumber} &bull; {resolutionModalMatch.eventName} ({resolutionModalMatch.roundName})</div>
              <div><strong>Red Corner:</strong> {resolutionModalMatch.redAthleteName || 'TBD'}</div>
              <div><strong>Blue Corner:</strong> {resolutionModalMatch.blueAthleteName || 'TBD'}</div>
            </div>

            {/* Select Winner */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                1. Select Declared Winner:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedWinnerId(resolutionModalMatch.redRegistrationId || '')}
                  disabled={!resolutionModalMatch.redRegistrationId}
                  className={`p-3 rounded-lg border text-xs font-bold text-left transition-all min-h-[44px] ${
                    selectedWinnerId === resolutionModalMatch.redRegistrationId
                      ? 'border-red-500 bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 ring-2 ring-red-500'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-red-500">Red Corner</div>
                  <div className="truncate mt-0.5">{resolutionModalMatch.redAthleteName || 'Red Athlete'}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedWinnerId(resolutionModalMatch.blueRegistrationId || '')}
                  disabled={!resolutionModalMatch.blueRegistrationId}
                  className={`p-3 rounded-lg border text-xs font-bold text-left transition-all min-h-[44px] ${
                    selectedWinnerId === resolutionModalMatch.blueRegistrationId
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-blue-500">Blue Corner</div>
                  <div className="truncate mt-0.5">{resolutionModalMatch.blueAthleteName || 'Blue Athlete'}</div>
                </button>
              </div>
            </div>

            {/* Decision Type */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                2. Select Decision Type:
              </label>
              <select
                value={selectedDecisionType}
                onChange={(e) => setSelectedDecisionType(e.target.value as DecisionType)}
                className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
              >
                <option value="DQ">DQ — Disqualification (Foul / Equipment / Conduct Violation)</option>
                <option value="DEFAULT">DEFAULT — Forfeit / Walkover (Opponent Failed to Report)</option>
                <option value="VOLUNTARY_DROP">VOLUNTARY_DROP — Withdrawal / Medical Forfeit</option>
                <option value="TKO">TKO — Technical Knockout / Referee Stoppage</option>
                <option value="POINTS">POINTS — Standard Score / Points Decision</option>
              </select>
            </div>

            {/* Resolution Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Arbitration Notes (Optional preliminary notes):
              </label>
              <input
                type="text"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="e.g. Failure to report within 3-minute window, certified by Chief Referee"
                className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setResolutionModalMatch(null);
                  setSelectedWinnerId('');
                  setResolutionNotes('');
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setIsResolutionGuardOpen(true)}
                disabled={isActionPending || !selectedWinnerId}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-50 min-h-[36px]"
              >
                Review &amp; Proceed to Final Confirmation
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2B: EMERGENCY MATCH RESOLUTION (CRITICAL GUARD STAGE 2)             */}
      {/* ========================================================================= */}
      <DestructiveActionGuardModal
        isOpen={isResolutionGuardOpen && !!resolutionModalMatch && !!selectedWinnerId}
        onCancel={() => setIsResolutionGuardOpen(false)}
        onConfirm={async (reason) => {
          await handleExecuteResolution(reason);
        }}
        title="Emergency Match Finalization & Bracket Progression"
        description="Finalize this bout under emergency arbitration protocol and advance the declared winner in the tournament bracket."
        riskTier="CRITICAL"
        targetEntityName={resolutionModalMatch ? `Match #${resolutionModalMatch.matchNumber} (${resolutionModalMatch.eventName} - ${resolutionModalMatch.roundName})` : undefined}
        consequence={resolutionModalMatch ? `This operation will IMMEDIATELY and IRREVERSIBLY terminate this match, declare ${selectedWinnerId === resolutionModalMatch.redRegistrationId ? (resolutionModalMatch.redAthleteName || 'Red Corner Athlete') : (resolutionModalMatch.blueAthleteName || 'Blue Corner Athlete')} as the winner by ${selectedDecisionType}, advance the winner in bracket progression, and mark the bout as completed. This action cannot be undone.` : undefined}
        requiredConfirmationText={
          selectedDecisionType === 'DQ'
            ? 'DISQUALIFY'
            : selectedDecisionType === 'DEFAULT'
            ? 'FORFEIT'
            : selectedDecisionType === 'VOLUNTARY_DROP'
            ? 'WALKOVER'
            : selectedDecisionType === 'TKO'
            ? 'STOPPAGE'
            : 'CONFIRM'
        }
        reasonPlaceholder="e.g. Failure to report within 3-minute window certified by Chief Referee, Rule 14.2 violation..."
        confirmButtonText="Execute Final Resolution"
      />

      {/* ========================================================================= */}
      {/* MODAL 3: TOGGLE RING STATUS (HIGH_RISK GUARD)                             */}
      {/* ========================================================================= */}
      <DestructiveActionGuardModal
        isOpen={!!ringToggleTarget}
        onCancel={() => setRingToggleTarget(null)}
        onConfirm={async (reason) => {
          await handleExecuteToggleCourt(reason);
        }}
        title={ringToggleTarget?.isActive ? 'Pause / Set Court Offline' : 'Reactivate Court Station'}
        description={ringToggleTarget?.isActive ? 'Temporarily pause operations and mark this ring as offline.' : 'Restore this court station to active operational status.'}
        riskTier="HIGH_RISK"
        targetEntityName={ringToggleTarget ? `Court ${ringToggleTarget.courtName}` : undefined}
        consequence={ringToggleTarget ? (
          ringToggleTarget.isActive
            ? ringToggleTarget.activeMatch
              ? `Court ${ringToggleTarget.courtName} will be set to OFFLINE / PAUSED. WARNING: Match #${ringToggleTarget.activeMatch.matchNumber} is currently assigned as LIVE on this ring. Pausing will mark the station as interrupted.`
              : `Court ${ringToggleTarget.courtName} will be set to OFFLINE / PAUSED and will not be available for new match dispatches.`
            : `Court ${ringToggleTarget.courtName} will be set to ONLINE / ACTIVE and will be restored to the available ring roster.`
        ) : undefined}
        requireReason={true}
        reasonPlaceholder="e.g. Floor inspection, electrical reset, official rotation, station ready..."
        confirmButtonText={ringToggleTarget?.isActive ? 'Set Court Offline' : 'Activate Court'}
      />

      {/* ========================================================================= */}
      {/* MODAL 4: LOG MANUAL TOURNAMENT INCIDENT                                   */}
      {/* ========================================================================= */}
      {isLogIncidentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3.5 sm:p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-4 sm:p-5 space-y-3 sm:space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 bg-rose-100 dark:bg-rose-950 text-rose-600 rounded-lg">
                  <ShieldAlert className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Log Operational Incident Report
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Records an authoritative incident report to the append-only tournament audit ledger.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLogIncidentModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteLogManualIncident} className="space-y-3">
              {/* Incident Category / Action */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Incident Action Type:
                </label>
                <select
                  value={manualAction}
                  onChange={(e) => setManualAction(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                >
                  <option value="EQUIPMENT_MALFUNCTION">EQUIPMENT_MALFUNCTION — Ring gear, timer, sensor, or armor failure</option>
                  <option value="MEDICAL_TIMEOUT">MEDICAL_TIMEOUT — Athlete injury or physician examination pause</option>
                  <option value="REFEREE_SUBSTITUTION">REFEREE_SUBSTITUTION — Official rotation or jury reassignment</option>
                  <option value="UNSPORTSMANLIKE_CONDUCT">UNSPORTSMANLIKE_CONDUCT — Coach or athlete behavioral disciplinary warning</option>
                  <option value="SCHEDULE_DELAY">SCHEDULE_DELAY — Bracket postponement or operational session hold</option>
                  <option value="DISPUTE_ARBITRATION">DISPUTE_ARBITRATION — Formal protest or video review resolution</option>
                  <option value="CUSTOM_INCIDENT_REPORT">CUSTOM_INCIDENT_REPORT — General operational incident note</option>
                </select>
              </div>

              {/* Severity */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Incident Severity:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['INFO', 'WARNING', 'CRITICAL'] as IncidentSeverity[]).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setManualSeverity(sev)}
                      className={`p-2 rounded-lg border text-xs font-bold text-center transition-all ${
                        manualSeverity === sev
                          ? sev === 'CRITICAL'
                            ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 ring-2 ring-rose-500'
                            : sev === 'WARNING'
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500'
                            : 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              {/* Associated Court (Optional) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Associated Ring (Optional):
                  </label>
                  <select
                    value={manualCourtId}
                    onChange={(e) => setManualCourtId(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">-- No specific ring --</option>
                    {telemetry.map((c) => (
                      <option key={c.courtId} value={c.courtId}>
                        Court {c.courtName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Associated Match (Optional):
                  </label>
                  <select
                    value={manualMatchId}
                    onChange={(e) => setManualMatchId(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">-- No specific match --</option>
                    {queue.map((m) => (
                      <option key={m.matchId} value={m.matchId}>
                        Match #{m.matchNumber} ({m.eventName})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Notes / Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Incident Narrative &amp; Action Taken:
                </label>
                <textarea
                  rows={3}
                  required
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Detailed factual statement: chronological sequence of events, personnel involved, immediate remediation executed..."
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsLogIncidentModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionPending || !manualNotes.trim()}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isActionPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Record Incident Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
