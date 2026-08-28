import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Tournament, TournamentSnapshot, TournamentEvent } from '../../types/tournament';
import { CourtTelemetry, SystemAuditLogEntry } from '../../types/courtOperations';
import { courtOperationsService } from '../../services/courtOperationsService';
import { tournamentService } from '../../services/tournamentService';
import { eventAssignmentService } from '../../services/eventAssignmentService';
import { ShiftReconciliationResult } from '../../types/eventAssignment';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatRpcError } from '../../utils/rpcErrorFormatter';
import { COMMAND_CENTER_SOPS, SopItem } from '../../constants/commandCenterSopRegistry';
import {
  Cpu,
  Activity,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Database,
  Lock,
  Layers,
  Radio,
  FileText,
  Clock,
  Terminal,
  Server,
  KeyRound,
  Users,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Search,
  Info,
  ShieldAlert,
  Wifi,
  ExternalLink,
} from 'lucide-react';

export interface TechAuditStationProps {
  tournament: Tournament;
  snapshot: TournamentSnapshot | null;
  telemetry: CourtTelemetry[];
  lastSyncedAt: Date | null;
  canManage: boolean;
  onRefreshTelemetry: () => void;
}

export const TechAuditStation: React.FC<TechAuditStationProps> = ({
  tournament,
  snapshot,
  telemetry,
  lastSyncedAt,
  canManage,
  onRefreshTelemetry,
}) => {
  const { isOnline, isReconnecting, isTabVisible } = useNetworkStatus();

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<SystemAuditLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Tournament Events for Reconciliation
  const [tournamentEvents, setTournamentEvents] = useState<TournamentEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  // Reconciliation RPC Action State
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [reconciliationResult, setReconciliationResult] = useState<ShiftReconciliationResult | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  // Technical Runbook State (P9-05A)
  const [runbookSearch, setRunbookSearch] = useState<string>('');
  const [runbookCategoryFilter, setRunbookCategoryFilter] = useState<'ALL' | 'TECH_REC' | 'NETWORK' | 'LOCK' | 'SECURITY' | 'CLOSURE'>('ALL');
  const [expandedSopId, setExpandedSopId] = useState<string | null>('tech-rec-01');

  // Filtered Technical Runbook Items (scoped to stationId 'TECH_AUDIT')
  const techSops = useMemo(() => {
    return COMMAND_CENTER_SOPS.filter((sop) => {
      // Must be relevant to TECH_AUDIT
      if (!sop.stationIds.includes('TECH_AUDIT')) return false;

      // Category filter
      if (runbookCategoryFilter === 'TECH_REC' && !sop.code.startsWith('TECH-REC')) return false;
      if (runbookCategoryFilter === 'NETWORK' && sop.category !== 'NETWORK_TELEMETRY') return false;
      if (runbookCategoryFilter === 'LOCK' && sop.category !== 'CONCURRENCY_LOCK') return false;
      if (runbookCategoryFilter === 'SECURITY' && sop.category !== 'SECURITY_AUTH') return false;
      if (runbookCategoryFilter === 'CLOSURE' && sop.category !== 'CLOSURE_SEAL') return false;

      // Search query
      if (runbookSearch.trim()) {
        const query = runbookSearch.toLowerCase();
        const matchesCode = sop.code.toLowerCase().includes(query);
        const matchesTitle = sop.title.toLowerCase().includes(query);
        const matchesSummary = sop.summary.toLowerCase().includes(query);
        const matchesSteps = sop.steps.some(
          (s) => s.title.toLowerCase().includes(query) || s.instruction.toLowerCase().includes(query)
        );
        return matchesCode || matchesTitle || matchesSummary || matchesSteps;
      }

      return true;
    });
  }, [runbookSearch, runbookCategoryFilter]);

  // Load authoritative audit logs
  const loadAuditLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    setLogError(null);
    try {
      const logs = await courtOperationsService.fetchTournamentAuditLogs(tournament.id, 40);
      setAuditLogs(logs);
    } catch (err: unknown) {
      setLogError(formatRpcError(err));
    } finally {
      setIsLoadingLogs(false);
    }
  }, [tournament.id]);

  // Load events for this tournament
  const loadEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      let events: TournamentEvent[] = [];
      if (snapshot?.id) {
        events = await tournamentService.getEventsBySnapshotId(snapshot.id);
      } else {
        events = await tournamentService.getEventsByTournamentId(tournament.id);
      }
      setTournamentEvents(events);
    } catch (err) {
      console.warn('Failed to load tournament events for Tech Audit reconciliation:', err);
      setTournamentEvents([]);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [snapshot?.id, tournament.id]);

  // Reset states and reload data on tournament or snapshot change
  useEffect(() => {
    setSelectedEventId('');
    setReconciliationResult(null);
    setReconciliationError(null);
    loadAuditLogs();
    loadEvents();
  }, [loadAuditLogs, loadEvents]);

  // Active telemetry event check
  const activeTelemetryEventId = telemetry.find((c) => c.activeMatch?.eventId)?.activeMatch?.eventId || '';

  // Auto-sync selected event with active telemetry if present
  useEffect(() => {
    if (activeTelemetryEventId) {
      setSelectedEventId(activeTelemetryEventId);
    }
  }, [activeTelemetryEventId]);

  // The active event object if known
  const activeEventFromTelemetry = tournamentEvents.find((e) => e.id === activeTelemetryEventId);

  // Effective target event ID
  const effectiveEventId = selectedEventId || activeTelemetryEventId;

  // Execute P7-03D Reconcile Event Assignments RPC
  const handleRunReconciliation = async () => {
    if (!canManage) return;
    if (!isOnline) {
      setReconciliationError('Cannot reconcile assignments while offline. Network connection required (INV-01).');
      return;
    }

    if (!effectiveEventId) {
      setReconciliationError('Please select a valid event from the tournament catalog for assignment reconciliation.');
      return;
    }

    setIsReconciling(true);
    setReconciliationError(null);
    setReconciliationResult(null);

    try {
      const result = await eventAssignmentService.reconcileEventAssignments(effectiveEventId);
      setReconciliationResult(result);
      onRefreshTelemetry();
      loadAuditLogs();
    } catch (err: unknown) {
      setReconciliationError(formatRpcError(err));
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-purple-500/15 border border-purple-500/30 text-purple-400 rounded-2xl">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-tight">
                Tech &amp; Platform Diagnostics Console
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[10px] font-mono font-bold">
                STATION 05
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Live WebSocket replication telemetry, server-side RBAC verification, and assignment reconciliation.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => {
              onRefreshTelemetry();
              loadAuditLogs();
            }}
            disabled={isLoadingLogs}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 text-xs font-bold transition-all flex items-center space-x-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin text-purple-400' : ''}`} />
            <span>Sync Telemetry &amp; Logs</span>
          </button>
        </div>
      </div>

      {/* Telemetry Health & Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Realtime WebSocket State */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Supabase Realtime Channel
            </span>
            <Radio className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-lg font-black text-white font-mono">
              {isOnline ? (isReconnecting ? 'RECONNECTING' : 'CHANNEL_ACTIVE') : 'DISCONNECTED'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono space-y-0.5">
            <p>Target: <span className="text-slate-300">court_ops_{tournament.id.slice(0, 8)}...</span></p>
            <p>Tables: <span className="text-slate-300">courts, assignments, matches, audit</span></p>
          </div>
        </div>

        {/* Snapshot & Database Invariant */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Snapshot Integrity (INV-01)
            </span>
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-black text-emerald-400 font-mono">
            {snapshot ? `SNAPSHOT_SEALED (v${snapshot.version})` : 'NO_SNAPSHOT'}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Rule configurations &amp; divisions are frozen in immutable database snapshot records.
          </p>
        </div>

        {/* Server-Side RBAC Guard */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Security Boundary (INV-04)
            </span>
            <ShieldCheck className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg font-black text-blue-400 font-mono">
            SECURITY_DEFINER
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            All mutations guarded server-side by PostgreSQL RLS and transaction-safe RPCs.
          </p>
        </div>
      </div>

      {/* P7-03D Assignment Reconciliation Panel */}
      {canManage && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2.5">
              <RefreshCw className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Event Assignment Reconciliation Tool (P7-03D)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
              RPC: reconcile_event_assignments
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Idempotently scans active official assignments for the current event. Deactivates any lingering assignments from completed tournaments, deactivated courts, or inactive user profiles without disturbing active bouts.
          </p>

          {/* Event Context & Selection for Reconciliation */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label htmlFor="tech-audit-event-select" className="text-xs font-bold text-slate-300 flex items-center space-x-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Target Event for Shift Reconciliation:</span>
              </label>

              {activeTelemetryEventId && (
                <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[11px] text-emerald-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Active Telemetry Match Event</span>
                </div>
              )}
            </div>

            {isLoadingEvents ? (
              <div className="text-xs text-slate-400 flex items-center space-x-2 py-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Loading tournament event catalog...</span>
              </div>
            ) : tournamentEvents.length > 0 ? (
              <div className="space-y-1.5">
                <div className="relative">
                  <select
                    id="tech-audit-event-select"
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setReconciliationError(null);
                      setReconciliationResult(null);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all appearance-none cursor-pointer pr-10"
                  >
                    <option value="" disabled>
                      {activeTelemetryEventId
                        ? 'Select Event for Shift Reconciliation (Defaults to active)'
                        : '-- Select an Event for Shift Reconciliation --'}
                    </option>
                    {tournamentEvents.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.name} ({evt.category} - {evt.division}
                        {evt.weight_class ? ` ${evt.weight_class}` : ''})
                        {evt.id === activeTelemetryEventId ? ' ★ [ACTIVE BOUT]' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {effectiveEventId && (
                  <p className="text-[11px] text-slate-400 font-mono">
                    Target Event ID: <span className="text-indigo-300 font-semibold">{effectiveEventId}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>No events registered for this tournament snapshot. Add events before running shift reconciliation.</span>
              </div>
            )}
          </div>

          {reconciliationResult && (
            <div className="p-4 bg-emerald-950/50 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 space-y-1 font-mono">
              <div className="flex items-center space-x-2 font-bold text-emerald-200">
                <CheckCircle2 className="w-4 h-4" />
                <span>Reconciliation Completed Successfully</span>
              </div>
              <p>Reconciled At: {new Date(reconciliationResult.reconciled_at).toLocaleString()}</p>
              <p>Deactivated Lingering Shifts: {reconciliationResult.deactivated_count}</p>
            </div>
          )}

          {reconciliationError && (
            <div className="p-4 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center space-x-2 font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{reconciliationError}</span>
            </div>
          )}

          <div className="flex items-center space-x-3 pt-1">
            <button
              type="button"
              onClick={handleRunReconciliation}
              disabled={isReconciling || !effectiveEventId || !isOnline}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
              <span>{isReconciling ? 'Reconciling Shifts...' : 'Run Assignment Reconciliation'}</span>
            </button>
            {!effectiveEventId && (
              <span className="text-[11px] text-slate-500 italic">
                (Select a target event above to enable reconciliation)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Read-Only Technical Runbook & Recovery Guide (P9-05A) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Technical Operational Runbook (Read-Only)
                </h3>
                <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                  P9-05A • {techSops.length} SOPs
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Authoritative technical reference procedures for network recovery, diagnostic interpretation, active-bout lock arbitration, and escalation.
              </p>
            </div>
          </div>
        </div>

        {/* Read-Only Governance & Invariant Notice */}
        <div className="p-3.5 bg-slate-950/80 border border-purple-500/20 rounded-xl flex items-start space-x-3 text-xs">
          <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="text-slate-300 space-y-0.5">
            <span className="font-bold text-purple-300">Strict Read-Only Reference:</span>{' '}
            <span className="text-slate-400">
              Procedures guide technical operators through verified recovery workflows. Runbook viewing performs ZERO database mutations, executes NO SQL, and bypasses NO server-side RBAC boundaries (INV-01, INV-02, INV-04).
            </span>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search technical runbooks by code, title, or error..."
              value={runbookSearch}
              onChange={(e) => setRunbookSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 text-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs placeholder:text-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setRunbookCategoryFilter('ALL')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                runbookCategoryFilter === 'ALL'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              All Tech SOPs
            </button>
            <button
              type="button"
              onClick={() => setRunbookCategoryFilter('TECH_REC')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                runbookCategoryFilter === 'TECH_REC'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              Recovery (TECH-REC)
            </button>
            <button
              type="button"
              onClick={() => setRunbookCategoryFilter('NETWORK')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                runbookCategoryFilter === 'NETWORK'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              Network &amp; Realtime
            </button>
            <button
              type="button"
              onClick={() => setRunbookCategoryFilter('LOCK')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                runbookCategoryFilter === 'LOCK'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              Lock &amp; Concurrency
            </button>
            <button
              type="button"
              onClick={() => setRunbookCategoryFilter('CLOSURE')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                runbookCategoryFilter === 'CLOSURE'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              Closure &amp; Seal
            </button>
          </div>
        </div>

        {/* SOP Accordion List */}
        <div className="space-y-3 pt-1">
          {techSops.length > 0 ? (
            techSops.map((sop) => {
              const isExpanded = expandedSopId === sop.id;
              return (
                <div
                  key={sop.id}
                  className={`bg-slate-950 border transition-all rounded-xl overflow-hidden ${
                    isExpanded ? 'border-purple-500/40 ring-1 ring-purple-500/20' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Card Header / Summary */}
                  <button
                    type="button"
                    onClick={() => setExpandedSopId(isExpanded ? null : sop.id)}
                    className="w-full p-4 text-left flex items-start justify-between gap-3 focus:outline-none"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-purple-500/15 border border-purple-500/30 text-purple-300">
                          {sop.code}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          sop.severity === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : sop.severity === 'HIGH'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : sop.severity === 'MEDIUM'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}>
                          {sop.severity || 'STANDARD'}
                        </span>
                        {sop.errorCode && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800/80">
                            ERR: {sop.errorCode}
                          </span>
                        )}
                        <h4 className="text-sm font-bold text-white">
                          {sop.title}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {sop.summary}
                      </p>
                    </div>

                    <div className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 shrink-0">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {/* Card Details / Steps (Expanded) */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 space-y-4 text-xs">
                      {/* Warnings */}
                      {sop.warnings && sop.warnings.length > 0 && (
                        <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl space-y-1.5 text-amber-300">
                          <div className="flex items-center space-x-2 font-bold text-[11px] uppercase tracking-wider text-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Operational Invariants &amp; Warnings</span>
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-300/90 leading-relaxed pl-1">
                            {sop.warnings.map((w, idx) => (
                              <li key={idx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Step by step instructions */}
                      <div className="space-y-2.5">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                          Step-by-Step Operator Instructions
                        </span>
                        <div className="space-y-2">
                          {sop.steps.map((step) => (
                            <div
                              key={step.stepNumber}
                              className="p-3 bg-slate-900/90 border border-slate-800/80 rounded-xl space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold flex items-center justify-center">
                                    {step.stepNumber}
                                  </span>
                                  <span className="font-bold text-slate-200 text-xs">
                                    {step.title}
                                  </span>
                                </div>
                              </div>
                              <p className="text-slate-300 text-xs leading-relaxed pl-7">
                                {step.instruction}
                              </p>
                              {step.expectedOutcome && (
                                <div className="pl-7 pt-1 flex items-center space-x-1.5 text-[11px] text-emerald-400 font-mono">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Expected Outcome: {step.expectedOutcome}</span>
                                </div>
                              )}
                              {step.warning && (
                                <div className="pl-7 pt-1 flex items-center space-x-1.5 text-[11px] text-amber-400 font-mono">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  <span>Caution: {step.warning}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Escalation and Related Metadata */}
                      <div className="pt-2 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                        <div className="flex items-center space-x-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                          <span>Escalation Authority:</span>
                          <span className="text-slate-200 font-bold">{sop.escalationAuthority}</span>
                        </div>
                        {sop.relatedRpcOrService && (
                          <div className="flex items-center space-x-1.5">
                            <span className="text-slate-500">Service:</span>
                            <span className="text-indigo-300 font-bold">{sop.relatedRpcOrService}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="p-6 text-center bg-slate-950/60 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
              No technical runbooks found matching filter &quot;{runbookSearch}&quot;.
            </div>
          )}
        </div>
      </div>

      {/* Authoritative System Audit Logs Stream */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Terminal className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Append-Only Governance &amp; Audit Trail ({auditLogs.length} Records)
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            RPC: get_tournament_incident_logs
          </span>
        </div>

        {logError && (
          <div className="p-3 bg-amber-950/50 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{logError}</span>
          </div>
        )}

        {auditLogs.length > 0 ? (
          <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 text-xs font-mono space-y-1.5 hover:border-slate-700 transition-all"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      log.action.includes('INCIDENT') || log.action.includes('CANCEL') || log.action.includes('ERROR')
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : log.action.includes('ASSIGN') || log.action.includes('ROTATE') || log.action.includes('RECONCILE')
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {log.action}
                    </span>
                    <span className="text-slate-300 font-bold">
                      {log.actor_profile?.full_name || log.actor_role || 'SYSTEM_OPERATOR'}
                    </span>
                  </div>

                  <span className="text-slate-500 text-[10px]">
                    {new Date(log.created_at).toLocaleTimeString()} ({new Date(log.created_at).toLocaleDateString()})
                  </span>
                </div>

                {log.details && (
                  <div className="text-[11px] text-slate-400 bg-slate-900/70 p-2 rounded-lg border border-slate-800/50 break-words">
                    {typeof log.details === 'string'
                      ? log.details
                      : JSON.stringify(log.details, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-slate-950/60 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
            {isLoadingLogs ? (
              <div className="flex items-center justify-center space-x-2 text-purple-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading system audit trail...</span>
              </div>
            ) : (
              'No audit records found for this tournament session.'
            )}
          </div>
        )}
      </div>
    </div>
  );
};
