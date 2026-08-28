import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { courtOperationsService } from '../../services/courtOperationsService';
import { tournamentService } from '../../services/tournamentService';
import { 
  CourtTelemetry, 
  EnrichedQueueMatch, 
  CourtOperationsMetrics 
} from '../../types/courtOperations';
import { Tournament, TournamentSnapshot, Court, TournamentEvent } from '../../types/tournament';
import { OperationalStationId } from '../../types/commandCenter';
import { CourtStationCard } from './CourtStationCard';
import { MatchQueueBoard } from './MatchQueueBoard';
import { ScoringArbitrationQueue } from './ScoringArbitrationQueue';
import { RegistrationWeighInQueue } from './RegistrationWeighInQueue';
import { IncidentRecoveryQueue } from './IncidentRecoveryQueue';
import { ArenaProjectorModal } from './ArenaProjectorModal';
import { EventOfficialAssignmentModal } from './EventOfficialAssignmentModal';
import { QueueIntelligenceStats } from './QueueIntelligenceStats';
import { DestructiveActionGuardModal } from '../common/DestructiveActionGuardModal';
import { CommandCenterLayout } from '../command-center/CommandCenterLayout';
import { DirectorHub } from '../command-center/DirectorHub';
import { TechAuditStation } from '../command-center/TechAuditStation';
import { 
  Radio, 
  Layers, 
  Activity, 
  RefreshCw, 
  AlertTriangle, 
  Filter, 
  ShieldAlert, 
  Sparkles,
  Trophy,
  Search,
  WifiOff,
  Scale,
  Gavel,
  ClipboardList,
  Maximize2,
  Users,
  Crown,
  Cpu,
  Award,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff
} from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { OperationalDiagnosticBar } from '../common/OperationalDiagnosticBar';

export type StationTab = OperationalStationId;

interface CourtOperationsCenterProps {
  tournament?: Tournament;
  snapshot?: TournamentSnapshot | null;
  canManage?: boolean;
  canScore?: boolean;
  onOpenScoringConsole?: (matchId: string, assignmentId: string) => void;
  onNavigateToScoring?: (courtId: string) => void;
}

export const CourtOperationsCenter: React.FC<CourtOperationsCenterProps> = ({
  tournament: propTournament,
  snapshot: propSnapshot,
  canManage: propCanManage,
  canScore: propCanScore,
  onOpenScoringConsole: propOnOpenScoringConsole,
  onNavigateToScoring,
}) => {
  const { roles } = useAuth();
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isOrganizer = roles.includes('ORGANIZER') || roles.includes('ADMIN');

  // Operational Management vs Scoring permission derivation
  const canManage = propCanManage !== undefined ? propCanManage : (isSuperAdmin || isOrganizer);
  const canScore = propCanScore !== undefined ? propCanScore : (isSuperAdmin || isOrganizer);

  // P7-04: 6-Station Navigation Model
  const [activeStationTab, setActiveStationTab] = useState<OperationalStationId>('COURT_OPERATIONS');

  // P5-04: Network & Sync Diagnostic state
  const { isOnline, isReconnecting, isTabVisible } = useNetworkStatus();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Tournaments & Selection
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(propTournament?.id || '');
  const [activeSnapshot, setActiveSnapshot] = useState<TournamentSnapshot | null>(propSnapshot || null);
  const [tournamentEvents, setTournamentEvents] = useState<TournamentEvent[]>([]);
  const [tournamentCourts, setTournamentCourts] = useState<Court[]>([]);
  const [isLoadingTournamentContext, setIsLoadingTournamentContext] = useState<boolean>(false);

  // Authoritative selected tournament object
  const selectedTournament = useMemo(() => {
    if (propTournament && propTournament.id === selectedTournamentId) {
      return propTournament;
    }
    return tournaments.find((t) => t.id === selectedTournamentId) || propTournament || null;
  }, [propTournament, selectedTournamentId, tournaments]);

  // Synchronize authoritative events and courts independently of queue matches
  useEffect(() => {
    let isMounted = true;

    if (!selectedTournamentId) {
      setTournamentEvents([]);
      setTournamentCourts([]);
      return;
    }

    const loadTournamentDetails = async () => {
      setIsLoadingTournamentContext(true);
      try {
        const [eventsRes, courtsRes] = await Promise.all([
          tournamentService.getEventsByTournamentId(selectedTournamentId),
          tournamentService.getCourts(selectedTournamentId),
        ]);

        if (isMounted) {
          setTournamentEvents(eventsRes || []);
          setTournamentCourts(courtsRes || []);
        }
      } catch (err) {
        console.warn('Could not load authoritative events/courts for tournament:', selectedTournamentId, err);
        if (isMounted) {
          setTournamentEvents([]);
          setTournamentCourts([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingTournamentContext(false);
        }
      }
    };

    loadTournamentDetails();

    return () => {
      isMounted = false;
    };
  }, [selectedTournamentId]);

  // Synchronize activeSnapshot when selectedTournamentId or propSnapshot changes
  useEffect(() => {
    let isMounted = true;

    const syncSnapshot = async () => {
      if (!selectedTournamentId) {
        setActiveSnapshot(null);
        return;
      }

      // If parent provided tournament and snapshot match the current selected tournament, use propSnapshot
      if (propTournament?.id === selectedTournamentId && propSnapshot !== undefined) {
        setActiveSnapshot(propSnapshot);
        return;
      }

      // Otherwise fetch authoritative active snapshot for the selected tournament
      try {
        const snap = await tournamentService.getActiveSnapshot(selectedTournamentId);
        if (isMounted) {
          setActiveSnapshot(snap);
        }
      } catch (err) {
        console.warn('Could not sync active snapshot for tournament:', selectedTournamentId, err);
        if (isMounted) {
          setActiveSnapshot(null);
        }
      }
    };

    syncSnapshot();

    return () => {
      isMounted = false;
    };
  }, [selectedTournamentId, propTournament?.id, propSnapshot]);

  // Arena Projector Modal State
  const [projectorCourt, setProjectorCourt] = useState<CourtTelemetry | null>(null);
  const [isProjectorOpen, setIsProjectorOpen] = useState<boolean>(false);

  // Telemetry & Queue State
  const [courts, setCourts] = useState<CourtTelemetry[]>([]);
  const [queueMatches, setQueueMatches] = useState<EnrichedQueueMatch[]>([]);
  const [metrics, setMetrics] = useState<CourtOperationsMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // P5-02-A: Dynamic Ring Filters
  const [selectedRingFilter, setSelectedRingFilter] = useState<string>('ALL');
  const [stateFilter, setStateFilter] = useState<'ALL' | 'LIVE' | 'VACANT' | 'READY'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Dispatch & Incident Modal States
  const [isAssignModalOpen, setIsAssignModalOpen] = useState<boolean>(false);
  const [selectedCourtForAssign, setSelectedCourtForAssign] = useState<string | null>(null);
  const [selectedMatchToAssign, setSelectedMatchToAssign] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);

  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState<boolean>(false);
  const [incidentCourtId, setIncidentCourtId] = useState<string | null>(null);
  const [incidentType, setIncidentType] = useState<string>('MEDICAL_TIMEOUT');
  const [incidentNotes, setIncidentNotes] = useState<string>('');
  const [isLoggingIncident, setIsLoggingIncident] = useState<boolean>(false);

  // Official Shift & Rotation Modal State
  const [isOfficialModalOpen, setIsOfficialModalOpen] = useState<boolean>(false);

  // P22.25-B2: Staged Quick Ring Reassignment State
  const [pendingReassignment, setPendingReassignment] = useState<{
    matchId: string;
    matchNumber: number;
    eventName: string;
    fromCourtId: string;
    fromCourtName: string;
    toCourtId: string;
    toCourtName: string;
  } | null>(null);

  // P22.24-B: Operational Focus Mode & Progressive Disclosure
  const [isFocusModeActive, setIsFocusModeActive] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && sessionStorage.getItem('uaaphil_court_focus_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [isQueueExpandedInFocus, setIsQueueExpandedInFocus] = useState<boolean>(false);

  const toggleFocusMode = useCallback(() => {
    setIsFocusModeActive((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('uaaphil_court_focus_mode', next.toString());
        }
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

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
      console.warn('Could not load tournaments for Court Operations:', err);
    }
  }, [selectedTournamentId]);

  useEffect(() => {
    loadTournaments();
  }, [loadTournaments]);

  // 2. Fetch authoritative telemetry & queue
  const loadTelemetry = useCallback(async (tId: string) => {
    if (!tId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [telemetryRes, queueRes] = await Promise.all([
        courtOperationsService.fetchTournamentCourtsTelemetry(tId),
        courtOperationsService.fetchEnrichedMatchQueue(tId),
      ]);

      const calculatedMetrics = courtOperationsService.calculateMetrics(telemetryRes, queueRes);

      setCourts(telemetryRes);
      setQueueMatches(queueRes);
      setMetrics(calculatedMetrics);
      setLastSyncedAt(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch court operations telemetry.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadTelemetry(selectedTournamentId);

      // Realtime subscription
      const unsubscribe = courtOperationsService.subscribeToCourtOperations(
        selectedTournamentId,
        () => {
          loadTelemetry(selectedTournamentId);
        }
      );

      return () => {
        unsubscribe();
      };
    }
  }, [selectedTournamentId, loadTelemetry]);

  // P5-04: Auto-reconnect & Visibility recovery effect
  useEffect(() => {
    if (isOnline && isTabVisible && selectedTournamentId) {
      loadTelemetry(selectedTournamentId);
    }
  }, [isOnline, isTabVisible, selectedTournamentId, loadTelemetry]);

  // P5-02-B: Deterministic Available / Recommended Ring Load Balancing
  const recommendedCourt = useMemo(() => {
    // 1st Priority: Active & AVAILABLE (Vacant) ring
    const vacant = courts.find((c) => c.isActive && c.state === 'AVAILABLE');
    if (vacant) return vacant;
    // 2nd Priority: Active ring not currently in LIVE combat
    const nonLive = courts.find((c) => c.isActive && c.state !== 'LIVE');
    return nonLive || null;
  }, [courts]);

  // P5-02-A: Filtered Courts derivation
  const filteredCourts = useMemo(() => {
    return courts.filter((court) => {
      // 1. Ring Filter
      if (selectedRingFilter !== 'ALL' && court.courtId !== selectedRingFilter) {
        return false;
      }
      // 2. State Filter
      if (stateFilter === 'LIVE' && court.state !== 'LIVE') return false;
      if (stateFilter === 'VACANT' && court.state !== 'AVAILABLE') return false;
      if (stateFilter === 'READY' && court.state !== 'ASSIGNED') return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const courtNameMatch = court.courtName.toLowerCase().includes(q);
        const matchNumberMatch = court.activeMatch?.matchNumber?.toString().includes(q);
        const athleteMatch = (court.activeMatch?.redAthlete.athleteName.toLowerCase().includes(q) ?? false) ||
          (court.activeMatch?.blueAthlete.athleteName.toLowerCase().includes(q) ?? false) ||
          (court.activeMatch?.eventName.toLowerCase().includes(q) ?? false);
        return courtNameMatch || matchNumberMatch || athleteMatch;
      }
      return true;
    });
  }, [courts, selectedRingFilter, stateFilter, searchQuery]);

  // P22.24-B: Presentation-layer court prioritization in Focus Mode
  const displayCourts = useMemo(() => {
    if (!isFocusModeActive) {
      return filteredCourts;
    }
    // Prioritize active rings (LIVE -> ASSIGNED -> AVAILABLE -> OFFLINE)
    return [...filteredCourts].sort((a, b) => {
      const getPriority = (c: CourtTelemetry) => {
        if (c.state === 'LIVE') return 4;
        if (c.state === 'ASSIGNED') return 3;
        if (c.isActive && c.state === 'AVAILABLE') return 2;
        if (c.isActive) return 1;
        return 0;
      };
      return getPriority(b) - getPriority(a);
    });
  }, [filteredCourts, isFocusModeActive]);

  // Unassigned Queue Matches ready for dispatch
  const unassignedQueueMatches = useMemo(() => {
    return queueMatches.filter((q) => q.queueState === 'READY');
  }, [queueMatches]);

  // Derive unique events list for MatchQueueBoard event filters
  const uniqueEvents = useMemo(() => {
    const map = new Map<string, string>();
    queueMatches.forEach((m) => {
      if (m.eventId && m.eventName) {
        map.set(m.eventId, m.eventName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [queueMatches]);

  // Unified scoring console open handler
  const handleOpenScoringConsole = useCallback(
    (matchId: string, assignmentId: string) => {
      if (propOnOpenScoringConsole) {
        propOnOpenScoringConsole(matchId, assignmentId);
      }
    },
    [propOnOpenScoringConsole]
  );

  // Handler: Dispatch Match to Court
  const handleConfirmDispatch = async () => {
    if (!isOnline) {
      setErrorMessage('Cannot dispatch match while offline. Please verify network connectivity.');
      return;
    }
    if (!selectedCourtForAssign || !selectedMatchToAssign) return;
    setIsAssigning(true);
    setErrorMessage(null);

    try {
      await courtOperationsService.dispatchMatchToCourt(
        selectedMatchToAssign,
        selectedCourtForAssign
      );
      setIsAssignModalOpen(false);
      setSelectedCourtForAssign(null);
      setSelectedMatchToAssign(null);
      if (selectedTournamentId) {
        await loadTelemetry(selectedTournamentId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dispatch failed.';
      setErrorMessage(`Dispatch notice: ${msg}`);
    } finally {
      setIsAssigning(false);
    }
  };

  // P22.25-B2: Stage Quick Ring Reassignment proposal (ZERO immediate mutation)
  const handleReassignMatch = (matchId: string, fromCourtId: string, toCourtId: string) => {
    if (!isOnline) {
      setErrorMessage('Cannot reassign match while offline. Please verify network connectivity.');
      return;
    }
    if (!matchId || !toCourtId || fromCourtId === toCourtId) return;

    // Resolve source court metadata
    const fromCourt = courts.find((c) => c.courtId === fromCourtId);
    const toCourt = courts.find((c) => c.courtId === toCourtId);

    // If source court has activeMatch metadata, use it; otherwise fallback safely
    const matchNumber = fromCourt?.activeMatch?.matchNumber || 0;
    const eventName = fromCourt?.activeMatch?.eventName || 'Tournament Bout';
    const fromCourtName = fromCourt?.courtName ? `Court ${fromCourt.courtName}` : 'Current Ring';
    const toCourtName = toCourt?.courtName ? `Court ${toCourt.courtName}` : 'Selected Ring';

    setErrorMessage(null);
    setPendingReassignment({
      matchId,
      matchNumber,
      eventName,
      fromCourtId,
      fromCourtName,
      toCourtId,
      toCourtName,
    });
  };

  // P22.25-B2: Authoritative Reassignment Execution Handler (Invoked ONLY after operator confirmation in DestructiveActionGuardModal)
  const handleExecuteReassignMatch = async () => {
    if (!pendingReassignment) return;
    const { matchId, toCourtId } = pendingReassignment;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Execute existing authoritative service dispatch
      await courtOperationsService.dispatchMatchToCourt(matchId, toCourtId);
      setPendingReassignment(null);
      if (selectedTournamentId) {
        await loadTelemetry(selectedTournamentId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reassignment failed.';
      setErrorMessage(`Reassignment notice: ${msg}`);
      setPendingReassignment(null);
      if (selectedTournamentId) {
        await loadTelemetry(selectedTournamentId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Log Incident
  const handleConfirmIncident = async () => {
    if (!isOnline) {
      setErrorMessage('Cannot record incident while offline. Please verify network connectivity.');
      return;
    }
    if (!selectedTournamentId || !incidentCourtId) return;
    setIsLoggingIncident(true);
    setErrorMessage(null);

    try {
      await courtOperationsService.logTournamentIncident({
        tournamentId: selectedTournamentId,
        action: `COURT_INCIDENT_${incidentType}`,
        severity: 'WARNING',
        entityType: 'COURT',
        entityId: incidentCourtId,
        details: { notes: incidentNotes, court_id: incidentCourtId }
      });
      setIsIncidentModalOpen(false);
      setIncidentCourtId(null);
      setIncidentNotes('');
      await loadTelemetry(selectedTournamentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record incident.';
      setErrorMessage(`Incident notice: ${msg}`);
    } finally {
      setIsLoggingIncident(false);
    }
  };

  return (
    <CommandCenterLayout
      activeStation={activeStationTab}
      onStationChange={setActiveStationTab}
      tournaments={tournaments}
      selectedTournamentId={selectedTournamentId}
      onTournamentChange={setSelectedTournamentId}
      snapshot={activeSnapshot}
      metrics={metrics}
      telemetry={courts}
      queue={queueMatches}
      isLoading={isLoading}
      lastSyncedAt={lastSyncedAt}
      onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
      canManage={canManage}
      onOpenOfficialRotationModal={() => setIsOfficialModalOpen(true)}
      errorMessage={errorMessage}
    >
      {/* P5-04: Operational Diagnostic & Connectivity Status */}
      <OperationalDiagnosticBar
        isOnline={isOnline}
        syncStatus={!isOnline ? 'OFFLINE' : isLoading ? 'SYNCHRONIZING' : errorMessage ? 'SYNC_ERROR' : 'SYNCED'}
        lastSyncedAt={lastSyncedAt}
        isLoading={isLoading}
        onForceSync={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
        contextLabel="Court Operations Center"
      />

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="p-4 bg-rose-950/90 border-2 border-rose-600 rounded-xl flex items-center justify-between gap-3 text-rose-200 text-xs shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <strong className="text-rose-100 text-sm font-bold block">OFFLINE — COURT MUTATIONS RESTRICTED</strong>
              <span>Browser is currently disconnected from network. Ring dispatch, reassignment, and incident logging require active PostgreSQL connection.</span>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded bg-rose-900 border border-rose-700 text-rose-200 font-mono text-[11px] shrink-0 font-bold">
            Offline Mode
          </span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 1. DIRECTOR HUB */}
      {/* ========================================================================= */}
      {activeStationTab === 'DIRECTOR_HUB' && (
        <DirectorHub
          tournament={selectedTournament}
          snapshot={activeSnapshot}
          metrics={metrics}
          telemetry={courts}
          queue={queueMatches}
          lastSyncedAt={lastSyncedAt}
          onNavigateToStation={setActiveStationTab}
          canManage={canManage}
        />
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 2. COURT OPERATIONS */}
      {/* ========================================================================= */}
      {activeStationTab === 'COURT_OPERATIONS' && (
        <div className="space-y-4 sm:space-y-6">
          {/* P5-02-A: DYNAMIC RING FILTERS, SEARCH TOOLBAR & FOCUS MODE TOGGLE */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
            {/* Ring selector pills */}
            <div className="flex items-center flex-wrap gap-1 sm:gap-1.5">
              <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mr-1 sm:mr-2 flex items-center space-x-1">
                <Filter className="w-3.5 h-3.5 text-amber-400" />
                <span>Rings:</span>
              </span>

              <button
                type="button"
                onClick={() => setSelectedRingFilter('ALL')}
                className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all min-h-[32px] sm:min-h-0 ${
                  selectedRingFilter === 'ALL'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                All Rings ({courts.length})
              </button>

              {courts.map((court) => (
                <button
                  key={court.courtId}
                  type="button"
                  onClick={() => setSelectedRingFilter(court.courtId)}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all flex items-center space-x-1.5 min-h-[32px] sm:min-h-0 ${
                    selectedRingFilter === court.courtId
                      ? 'bg-slate-200 text-slate-900 shadow-md font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{court.courtName}</span>
                  {court.state === 'LIVE' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                  )}
                </button>
              ))}
            </div>

            {/* State filters, search input & Focus Mode toggle */}
            <div className="flex items-center space-x-2 flex-wrap gap-y-2">
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setStateFilter('ALL')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-medium transition-all text-[11px] sm:text-xs ${
                    stateFilter === 'ALL' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setStateFilter('LIVE')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-medium transition-all text-[11px] sm:text-xs ${
                    stateFilter === 'LIVE' ? 'bg-rose-950 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Live Only
                </button>
                <button
                  type="button"
                  onClick={() => setStateFilter('VACANT')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-medium transition-all text-[11px] sm:text-xs ${
                    stateFilter === 'VACANT' ? 'bg-emerald-950 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Vacant Only
                </button>
              </div>

              <div className="relative flex-1 sm:flex-initial">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search match # / athlete..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500 w-full sm:w-44"
                />
              </div>

              {/* P22.24-B: Focus Mode Toggle Button */}
              <button
                type="button"
                onClick={toggleFocusMode}
                aria-pressed={isFocusModeActive}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center space-x-1.5 min-h-[36px] sm:min-h-0 shrink-0 ${
                  isFocusModeActive
                    ? 'bg-amber-500 text-slate-950 shadow-md ring-1 ring-amber-400'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title={isFocusModeActive ? 'Exit Operational Focus Mode' : 'Enter Operational Focus Mode (Prioritize Active Rings)'}
              >
                {isFocusModeActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{isFocusModeActive ? 'Focus Mode ON' : 'Focus Mode'}</span>
              </button>
            </div>
          </div>

          {/* Focus Mode Active Contextual Banner */}
          {isFocusModeActive && (
            <div className="px-3.5 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-center justify-between gap-3 text-xs shadow-xs">
              <div className="flex items-center space-x-2.5 text-amber-300">
                <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
                <span className="font-semibold text-[11px] sm:text-xs">
                  Operational Focus Mode Active — Prioritizing active combat rings. Secondary queue sections are progressively collapsed.
                </span>
              </div>
              <button
                type="button"
                onClick={toggleFocusMode}
                className="text-[11px] text-amber-400 hover:text-amber-200 font-bold underline shrink-0 cursor-pointer"
              >
                Disable Focus
              </button>
            </div>
          )}

          {/* P5-02-B: DETERMINISTIC LOAD BALANCING RECOMMENDATION BANNER */}
          {canManage && unassignedQueueMatches.length > 0 && (
            <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 border border-amber-500/30 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
              <div className="flex items-center space-x-2.5 sm:space-x-3">
                <div className="p-1.5 sm:p-2 bg-amber-500/20 text-amber-300 rounded-lg border border-amber-500/30 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                    <span>Ring Load-Balancing Recommendation</span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5">
                    {recommendedCourt ? (
                      <>
                        Next available dispatch station: <strong className="text-white font-mono">{recommendedCourt.courtName}</strong> ({recommendedCourt.state}).
                      </>
                    ) : (
                      'All active rings are currently occupied with Live or Called bouts.'
                    )}
                  </p>
                </div>
              </div>

              {recommendedCourt && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCourtForAssign(recommendedCourt.courtId);
                    setSelectedMatchToAssign(unassignedQueueMatches[0]?.matchId || null);
                    setIsAssignModalOpen(true);
                  }}
                  className="px-3 py-1.5 sm:px-3.5 sm:py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-all flex items-center justify-center space-x-1.5 shadow min-h-[38px] sm:min-h-0"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Dispatch Next to {recommendedCourt.courtName}</span>
                </button>
              )}
            </div>
          )}

          {/* COURT STATIONS GRID */}
          {displayCourts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
              {displayCourts.map((court) => (
                <CourtStationCard
                  key={court.courtId}
                  court={court}
                  allCourts={courts}
                  canManage={canManage}
                  canScore={canScore}
                  onOpenStation={(cId) => onNavigateToScoring && onNavigateToScoring(cId)}
                  onOpenAssignModal={(cId) => {
                    setSelectedCourtForAssign(cId);
                    setIsAssignModalOpen(true);
                  }}
                  onOpenIncidentModal={(cId) => {
                    setIncidentCourtId(cId);
                    setIsIncidentModalOpen(true);
                  }}
                  onOpenProjector={(c) => {
                    setProjectorCourt(c);
                    setIsProjectorOpen(true);
                  }}
                  onReassignMatch={handleReassignMatch}
                />
              ))}
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-dashed border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
              <Radio className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <h4 className="text-base font-bold text-white">No Matching Court Stations</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No rings match your active filter settings. Try selecting &quot;All Rings&quot; or clearing your search criteria.
              </p>
            </div>
          )}

          {/* Queue Board Section: Progressive Disclosure in Focus Mode vs Standard Expanded View in Normal Mode */}
          {isFocusModeActive ? (
            /* Focus Mode: Progressive Disclosure Container */
            <div className="pt-3 sm:pt-4 space-y-3">
              <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-xl p-3 sm:p-4 shadow-sm">
                <div className="flex items-center space-x-2.5 sm:space-x-3">
                  <ClipboardList className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <span className="text-xs sm:text-sm font-bold text-white block">
                      Ring Dispatch Queue
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-slate-400">
                      {unassignedQueueMatches.length} bouts ready for dispatch • {queueMatches.length} total in queue
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsQueueExpandedInFocus((prev) => !prev)}
                  aria-expanded={isQueueExpandedInFocus}
                  className="px-3 py-1.5 sm:px-3.5 sm:py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 min-h-[38px] sm:min-h-0 shadow-xs cursor-pointer"
                >
                  <span>
                    {isQueueExpandedInFocus
                      ? 'Hide Dispatch Queue'
                      : `Show Dispatch Queue (${unassignedQueueMatches.length} Ready)`}
                  </span>
                  {isQueueExpandedInFocus ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>

              {isQueueExpandedInFocus && (
                <div className="space-y-4 pt-1 animate-in fade-in slide-in-from-top-2 duration-200">
                  {metrics && <QueueIntelligenceStats metrics={metrics} courts={courts} />}
                  <MatchQueueBoard
                    queue={queueMatches}
                    events={uniqueEvents}
                    canManage={canManage}
                    canScore={canScore}
                    onAssignMatch={(matchId) => {
                      setSelectedMatchToAssign(matchId);
                      setIsAssignModalOpen(true);
                    }}
                    onOpenScoringConsole={handleOpenScoringConsole}
                    onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Normal Mode: Standard Always-Visible Queue Board Section */
            <div className="pt-4 space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <ClipboardList className="w-4 h-4 text-amber-400" />
                <span>Ring Dispatch Queue ({queueMatches.length} Bouts)</span>
              </h3>
              {metrics && <QueueIntelligenceStats metrics={metrics} courts={courts} />}
              <MatchQueueBoard
                queue={queueMatches}
                events={uniqueEvents}
                canManage={canManage}
                canScore={canScore}
                onAssignMatch={(matchId) => {
                  setSelectedMatchToAssign(matchId);
                  setIsAssignModalOpen(true);
                }}
                onOpenScoringConsole={handleOpenScoringConsole}
                onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
              />
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 3. SCORING ARBITRATION */}
      {/* ========================================================================= */}
      {activeStationTab === 'SCORING_DESK' && (
        <ScoringArbitrationQueue
          telemetry={courts}
          queue={queueMatches}
          canScore={canScore}
          onOpenScoringConsole={handleOpenScoringConsole}
          onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
        />
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 4. REGISTRATION & WEIGH-IN */}
      {/* ========================================================================= */}
      {activeStationTab === 'REGISTRATION_WEIGHIN' && selectedTournament && (
        <RegistrationWeighInQueue
          tournament={selectedTournament}
          snapshot={activeSnapshot}
          canManage={canManage}
          onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
        />
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 5. TECH & PLATFORM DIAGNOSTICS */}
      {/* ========================================================================= */}
      {activeStationTab === 'TECH_AUDIT' && selectedTournament && (
        <TechAuditStation
          tournament={selectedTournament}
          snapshot={activeSnapshot}
          telemetry={courts}
          lastSyncedAt={lastSyncedAt}
          canManage={canManage}
          onRefreshTelemetry={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
        />
      )}

      {/* ========================================================================= */}
      {/* STATION VIEW: 6. INCIDENTS & STOPPAGES */}
      {/* ========================================================================= */}
      {activeStationTab === 'INCIDENT_RECOVERY' && selectedTournament && (
        <IncidentRecoveryQueue
          tournament={selectedTournament}
          snapshot={activeSnapshot}
          telemetry={courts}
          queue={queueMatches}
          canManage={canManage}
          canScore={canScore}
          onOpenScoringConsole={handleOpenScoringConsole}
          onRefresh={() => selectedTournamentId && loadTelemetry(selectedTournamentId)}
        />
      )}

      {/* ========================================================================= */}
      {/* DISPATCH MATCH MODAL */}
      {/* ========================================================================= */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 max-w-lg w-full space-y-4 sm:space-y-5 shadow-2xl animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <Layers className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">Dispatch Match to Ring</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-xs font-mono font-bold"
              >
                ✕ CLOSE
              </button>
            </div>

            <div className="space-y-3 sm:space-y-4">
              {/* Ring selector */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Target Court Station
                </label>
                <select
                  value={selectedCourtForAssign || ''}
                  onChange={(e) => setSelectedCourtForAssign(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-medium focus:outline-none focus:border-amber-500"
                >
                  <option value="" disabled>Select a court...</option>
                  {courts.map((c) => (
                    <option key={c.courtId} value={c.courtId}>
                      {c.courtName} ({c.state})
                    </option>
                  ))}
                </select>
              </div>

              {/* Match selector from unassigned queue */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Select Queued Bout ({unassignedQueueMatches.length} pending)
                </label>
                {unassignedQueueMatches.length > 0 ? (
                  <select
                    value={selectedMatchToAssign || ''}
                    onChange={(e) => setSelectedMatchToAssign(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-medium focus:outline-none focus:border-amber-500"
                  >
                    <option value="" disabled>Select match from queue...</option>
                    {unassignedQueueMatches.map((m) => (
                      <option key={m.matchId} value={m.matchId}>
                        Match #{m.matchNumber} — {m.eventName} ({m.redAthlete?.athleteName || 'Red'} vs {m.blueAthlete?.athleteName || 'Blue'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-500 italic">
                    No unassigned matches remaining in the queue.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDispatch}
                disabled={isAssigning || !selectedCourtForAssign || !selectedMatchToAssign}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all disabled:opacity-50 shadow min-h-[38px]"
              >
                {isAssigning ? 'Dispatching...' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* LOG INCIDENT MODAL */}
      {/* ========================================================================= */}
      {isIncidentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="incident-modal-title"
            tabIndex={-1}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 max-w-md w-full space-y-3 sm:space-y-4 shadow-2xl animate-in fade-in focus:outline-hidden"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
                <h3 id="incident-modal-title" className="text-sm sm:text-base font-bold text-white">Log Ring Incident</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsIncidentModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-xs font-mono font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Incident Type
                </label>
                <select
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                >
                  <option value="MEDICAL_TIMEOUT">Medical Timeout (Injury / Doctor Check)</option>
                  <option value="EQUIPMENT_REPAIR">Gear / Armor Malfunction</option>
                  <option value="OFFICIAL_DISPUTE">Arbiter / Coach Protest</option>
                  <option value="BOUT_STOPPAGE">Referee Bout Stoppage</option>
                  <option value="OTHER">General Platform Notice</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Arbitration Notes
                </label>
                <textarea
                  rows={3}
                  value={incidentNotes}
                  onChange={(e) => setIncidentNotes(e.target.value)}
                  placeholder="Provide incident context, medical notes, or referee decision..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => setIsIncidentModalOpen(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmIncident}
                disabled={isLoggingIncident}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-all disabled:opacity-50 shadow min-h-[38px]"
              >
                {isLoggingIncident ? 'Recording...' : 'Record Incident Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* P5-05: ARENA PROJECTOR MODAL */}
      {/* ========================================================================= */}
      {isProjectorOpen && projectorCourt && (
        <ArenaProjectorModal
          isOpen={isProjectorOpen}
          court={projectorCourt}
          tournamentName={selectedTournament?.name || 'UAAPHIL Tournament Arena'}
          onClose={() => {
            setIsProjectorOpen(false);
            setProjectorCourt(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* P7-03C: EVENT OFFICIAL ASSIGNMENT & ATOMIC BATCH ROTATION MODAL */}
      {/* ========================================================================= */}
      {isOfficialModalOpen && selectedTournamentId && (
        <EventOfficialAssignmentModal
          isOpen={isOfficialModalOpen}
          tournament={selectedTournament || {
            id: selectedTournamentId,
            name: tournaments.find((t) => t.id === selectedTournamentId)?.name || 'UAAPHIL Tournament',
            organizer_id: '',
            slug: '',
            description: null,
            start_date: '',
            end_date: '',
            status: 'REGISTRATION_CLOSED',
            created_at: '',
          }}
          tournamentId={selectedTournamentId}
          events={tournamentEvents}
          courts={tournamentCourts}
          isSuperOrOrganizer={canManage}
          onClose={() => setIsOfficialModalOpen(false)}
          onAssignmentChanged={() => {
            if (selectedTournamentId) {
              loadTelemetry(selectedTournamentId);
            }
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* P22.25-B2: QUICK RING REASSIGNMENT SAFETY GUARD MODAL */}
      {/* ========================================================================= */}
      <DestructiveActionGuardModal
        isOpen={!!pendingReassignment}
        onCancel={() => setPendingReassignment(null)}
        onConfirm={handleExecuteReassignMatch}
        title="Confirm Ring Reassignment"
        description="Reassign this scheduled bout to another operational ring station."
        riskTier="HIGH_RISK"
        targetEntityName={
          pendingReassignment
            ? `Match #${pendingReassignment.matchNumber} (${pendingReassignment.eventName})`
            : undefined
        }
        consequence={
          pendingReassignment
            ? `Match #${pendingReassignment.matchNumber} will be moved from ${pendingReassignment.fromCourtName} to ${pendingReassignment.toCourtName}. Table officials and scorekeepers at both stations will be notified of the schedule change.`
            : undefined
        }
        requireReason={false}
        confirmButtonText="Reassign Ring"
        cancelButtonText="Cancel"
      />
    </CommandCenterLayout>
  );
};
