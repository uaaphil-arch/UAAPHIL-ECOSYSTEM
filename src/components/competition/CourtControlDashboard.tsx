import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Layers,
  Radio,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trophy,
  Users,
  ChevronRight,
  ExternalLink,
  Eye,
  Activity,
} from 'lucide-react';
import { Court, CourtAssignment, Match, Tournament, TournamentSnapshot, TournamentEvent, AnyoCategorySession, AnyoPerformance, AnyoScore } from '../../types/tournament';
import { tournamentService } from '../../services/tournamentService';
import { scoringService } from '../../services/scoringService';
import { anyoScoringService } from '../../services/anyoScoringService';
import { useAuth } from '../../context/AuthContext';
import { resolvePrimaryAssignment } from '../../utils/authorization';
import { LiveScoringConsole } from './LiveScoringConsole';
import { PublicScoreboardModal } from './PublicScoreboardModal';
import { AnyoScoringConsole } from './AnyoScoringConsole';
import { AnyoPublicScoreboardModal } from './AnyoPublicScoreboardModal';
import { CourtOperationsCenter } from '../court-operations/CourtOperationsCenter';
import { formatRpcError } from '../../utils/rpcErrorFormatter';

export const CourtControlDashboard: React.FC = () => {
  const { user, roles, activeAssignments, hasActiveOperationalAssignment } = useAuth();
  const primaryAssignment = resolvePrimaryAssignment(activeAssignments);

  // Engine Mode: FULL_CONTACT vs ANYO vs OPERATIONS
  const [competitionMode, setCompetitionMode] = useState<'FULL_CONTACT' | 'ANYO' | 'OPERATIONS'>('OPERATIONS');

  // Tournaments State
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
  const [selectedSnapshot, setSelectedSnapshot] = useState<TournamentSnapshot | null>(null);
  const [isLoadingTournaments, setIsLoadingTournaments] = useState<boolean>(true);

  // Authority State (Perm roles or Event Official)
  const [isOfficialAuthorized, setIsOfficialAuthorized] = useState<boolean>(false);
  const [canRecordScores, setCanRecordScores] = useState<boolean>(false);

  // Courts & Matches State (Full Contact)
  const [courts, setCourts] = useState<Court[]>([]);
  const [assignments, setAssignments] = useState<CourtAssignment[]>([]);
  const [assignableMatches, setAssignableMatches] = useState<Match[]>([]);
  const [isLoadingCourtData, setIsLoadingCourtData] = useState<boolean>(false);

  // Anyo Events & Active Anyo Session State
  const [anyoEvents, setAnyoEvents] = useState<TournamentEvent[]>([]);
  const [activeAnyoSession, setActiveAnyoSession] = useState<{
    session: AnyoCategorySession;
    performances: AnyoPerformance[];
    scores: AnyoScore[];
  } | null>(null);
  const [activeAnyoScoreboard, setActiveAnyoScoreboard] = useState<{
    session: AnyoCategorySession;
    performances: AnyoPerformance[];
    scores: AnyoScore[];
  } | null>(null);
  const [isLoadingAnyo, setIsLoadingAnyo] = useState<boolean>(false);

  // Active Scoring Console Session State (Full Contact)
  const [activeScoringSession, setActiveScoringSession] = useState<{
    court: Court;
    match: Match;
    assignmentId: string;
  } | null>(null);

  // Public Scoreboard Modal State for any court (Full Contact)
  const [activeScoreboardSession, setActiveScoreboardSession] = useState<{
    court: Court;
    match: Match;
  } | null>(null);

  // Assign Modal State
  const [selectedCourtForAssignment, setSelectedCourtForAssignment] = useState<Court | null>(null);
  const [selectedMatchIdToAssign, setSelectedMatchIdToAssign] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [isResolvingConsole, setIsResolvingConsole] = useState<boolean>(false);

  // Feedback State
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check Official Authority & Scoring Authority whenever tournament or user changes
  useEffect(() => {
    async function checkAuth() {
      if (!user || !selectedTournamentId) {
        setIsOfficialAuthorized(false);
        setCanRecordScores(false);
        return;
      }
      const hasPerm = roles.some((r) => ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'].includes(r));
      if (hasPerm) {
        setIsOfficialAuthorized(true);
        setCanRecordScores(true);
        return;
      }
      // General operational authority (permits COURT_MANAGER for court management & dispatches)
      const isOfficial = await scoringService.checkOfficialAuthority(user.id, selectedTournamentId, undefined, undefined, true);
      // Dedicated scoring write authority (strictly enforces TABLE_OFFICIAL / Admin via p_allow_court_manager = false)
      const canScore = isOfficial
        ? await scoringService.checkOfficialAuthority(user.id, selectedTournamentId, undefined, undefined, false)
        : false;

      setIsOfficialAuthorized(isOfficial);
      setCanRecordScores(canScore);
    }
    checkAuth();
  }, [user, roles, selectedTournamentId]);

  // 1. Load Tournaments
  const loadTournaments = useCallback(async () => {
    try {
      setIsLoadingTournaments(true);
      setError(null);
      const list = await tournamentService.getTournaments();
      setTournaments(list);

      // Default to ongoing or first tournament
      const ongoing = list.find((t) => t.status === 'ONGOING');
      if (ongoing) {
        setSelectedTournamentId(ongoing.id);
      } else if (list.length > 0) {
        setSelectedTournamentId(list[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load tournaments.';
      console.error('Error loading tournaments:', err);
      setError(msg);
    } finally {
      setIsLoadingTournaments(false);
    }
  }, []);

  useEffect(() => {
    loadTournaments();
  }, [loadTournaments]);

  // 2. Load Courts, Matches & Anyo Events for Selected Tournament
  const loadCourtData = useCallback(async (tId: string) => {
    if (!tId) return;
    try {
      setIsLoadingCourtData(true);
      setError(null);

      const [courtOverview, matches, eventsList, activeSnap] = await Promise.all([
        scoringService.getCourtsWithAssignments(tId),
        scoringService.getAssignableMatches(tId),
        tournamentService.getEventsByTournamentId(tId),
        tournamentService.getActiveSnapshot(tId).catch(() => null),
      ]);

      setCourts(courtOverview.courts);
      setAssignments(courtOverview.assignments);
      setAssignableMatches(matches);
      setSelectedSnapshot(activeSnap);

      // Filter Anyo events
      const anyoList = eventsList.filter(
        (e) => e.category.startsWith('Anyo') || e.category.startsWith('Team')
      );
      setAnyoEvents(anyoList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load court data.';
      console.error('Error loading court data:', err);
      setError(msg);
    } finally {
      setIsLoadingCourtData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadCourtData(selectedTournamentId);
    }
  }, [selectedTournamentId, loadCourtData]);

  // Handle Open Anyo Session
  const handleOpenAnyoSession = async (event: TournamentEvent, courtId?: string) => {
    try {
      setIsLoadingAnyo(true);
      setError(null);
      const session = await anyoScoringService.getOrCreateSession(
        selectedTournamentId,
        event.id,
        courtId
      );
      const [performances, scores] = await Promise.all([
        anyoScoringService.getSessionPerformances(session.id),
        anyoScoringService.getSessionScores(session.id),
      ]);

      setActiveAnyoSession({
        session,
        performances,
        scores,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to open Anyo session.';
      console.error('Error opening Anyo session:', err);
      setError(msg);
    } finally {
      setIsLoadingAnyo(false);
    }
  };

  const handleRefreshAnyoSession = async () => {
    if (!activeAnyoSession) return;
    try {
      const [freshSession, performances, scores] = await Promise.all([
        anyoScoringService.getSession(activeAnyoSession.session.id),
        anyoScoringService.getSessionPerformances(activeAnyoSession.session.id),
        anyoScoringService.getSessionScores(activeAnyoSession.session.id),
      ]);
      setActiveAnyoSession((prev) =>
        prev
          ? {
              session: freshSession || prev.session,
              performances,
              scores,
            }
          : null
      );
    } catch (err: unknown) {
      console.error('Error refreshing Anyo session:', err);
    }
  };

  // Handle Assign Match to Court
  const handleAssignMatch = async () => {
    if (!selectedCourtForAssignment || !selectedMatchIdToAssign) return;

    try {
      setIsAssigning(true);
      setError(null);

      await scoringService.assignMatchToCourt(selectedMatchIdToAssign, selectedCourtForAssignment.id);

      setSuccessMessage(`Match successfully queued on Court ${selectedCourtForAssignment.identifier}.`);
      setSelectedCourtForAssignment(null);
      setSelectedMatchIdToAssign('');
      await loadCourtData(selectedTournamentId);
    } catch (err: unknown) {
      console.error('Assign match error:', err);
      setError(formatRpcError(err));
    } finally {
      setIsAssigning(false);
    }
  };

  // Handle Start Match (Go LIVE)
  const handleStartMatch = async (court: Court, assignment: CourtAssignment) => {
    try {
      setError(null);
      await scoringService.startCourtMatch(assignment.id);

      // Refresh data
      await loadCourtData(selectedTournamentId);

      // Fetch fresh match details to launch console
      if (assignment.match) {
        setActiveScoringSession({
          court,
          match: assignment.match,
          assignmentId: assignment.id,
        });
      }
    } catch (err: unknown) {
      console.error('Start match error:', err);
      setError(formatRpcError(err));
    }
  };

  // If in active Anyo scoring console mode, render AnyoScoringConsole
  if (activeAnyoSession) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => {
            setActiveAnyoSession(null);
            loadCourtData(selectedTournamentId);
          }}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2 border border-slate-700"
        >
          ← Back to Court & Anyo Queue
        </button>

        <AnyoScoringConsole
          session={activeAnyoSession.session}
          performances={activeAnyoSession.performances}
          scores={activeAnyoSession.scores}
          isReadOnly={!canRecordScores}
          onRefresh={handleRefreshAnyoSession}
          onOpenScoreboard={() => setActiveAnyoScoreboard(activeAnyoSession)}
        />

        {activeAnyoScoreboard && (
          <AnyoPublicScoreboardModal
            isOpen={true}
            onClose={() => setActiveAnyoScoreboard(null)}
            session={activeAnyoScoreboard.session}
            performances={activeAnyoScoreboard.performances}
            scores={activeAnyoScoreboard.scores}
            onRefresh={handleRefreshAnyoSession}
          />
        )}
      </div>
    );
  }

  // If in active scoring console mode (Full Contact), render LiveScoringConsole
  if (activeScoringSession) {
    const isCourtManagerOversight = isOfficialAuthorized && !canRecordScores;

    return (
      <div className="space-y-4">
        {/* Court Manager Oversight Mode Explanation Banner */}
        {isCourtManagerOversight && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start sm:items-center gap-3 shadow-lg">
            <Shield className="w-5 h-5 shrink-0 text-amber-400 mt-0.5 sm:mt-0" />
            <div>
              <p className="font-bold text-amber-200 uppercase tracking-wide">
                COURT MANAGER — OVERSIGHT MODE
              </p>
              <p className="text-slate-300 mt-0.5">
                You can monitor court operations, but live score entry is reserved for assigned Table Officials and authorized tournament administrators.
              </p>
            </div>
          </div>
        )}

        <LiveScoringConsole
          court={activeScoringSession.court}
          match={activeScoringSession.match}
          assignmentId={activeScoringSession.assignmentId}
          isReadOnly={!canRecordScores}
          onMatchCompleted={async () => {
            setActiveScoringSession(null);
            setSuccessMessage('Match completed and official result recorded! Winner advanced.');
            await loadCourtData(selectedTournamentId);
          }}
          onBackToQueue={() => {
            setActiveScoringSession(null);
            loadCourtData(selectedTournamentId);
          }}
        />
      </div>
    );
  }

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);

  return (
    <div className="space-y-6">
      {/* Header & Tournament Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-slate-100 break-words">
                Court Control & Live Competition
              </h1>
              {!isOfficialAuthorized ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-800 text-amber-300 border border-amber-500/30 shrink-0">
                  <Eye className="w-3 h-3" /> READ-ONLY / SPECTATOR MODE
                </span>
              ) : !canRecordScores ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                  <Shield className="w-3 h-3" /> OVERSIGHT MODE (COURT MANAGER)
                </span>
              ) : roles.length === 0 ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                  <CheckCircle2 className="w-3 h-3" /> TABLE OFFICIAL (ASSIGNED)
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {canRecordScores
                ? 'Live match queuing, court status oversight, and Full Contact scoring operator console.'
                : isOfficialAuthorized
                ? 'Court management and operational oversight active. Live score entry reserved for assigned Table Officials.'
                : 'Live match queuing and public court oversight. Operator controls reserved for authorized officials.'}
            </p>
          </div>
        </div>

        {/* Tournament Selector */}
        <div className="flex items-center gap-3 w-full md:w-auto min-w-0">
          <div className="flex flex-col flex-1 sm:flex-initial min-w-0 max-w-full">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Active Tournament
            </label>
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              disabled={isLoadingTournaments}
              className="w-full sm:w-auto sm:max-w-xs md:max-w-sm px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 truncate"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadCourtData(selectedTournamentId)}
            disabled={isLoadingCourtData || !selectedTournamentId}
            className="p-2.5 mt-4 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            title="Refresh Court State"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingCourtData ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-200">
            &times;
          </button>
        </div>
      )}

      {/* Coach/Spectator & Court Manager Notices */}
      {!isOfficialAuthorized ? (
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs flex items-center gap-3">
          <Eye className="w-5 h-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-bold text-slate-200">Spectator & Coach View Active</p>
            <p className="text-slate-400 mt-0.5">
              You are viewing court assignments in read-only mode. Match queuing and court oversight require Official authorization. Live scoring is reserved for Table Officials and Tournament Administrators.
            </p>
          </div>
        </div>
      ) : !canRecordScores ? (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-3">
          <Shield className="w-5 h-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-bold text-amber-200">Court Manager Oversight Active</p>
            <p className="text-slate-300 mt-0.5">
              You can manage court queues and oversee ring operations. Live score entry is reserved for assigned Table Officials and tournament administrators.
            </p>
          </div>
        </div>
      ) : roles.length === 0 && hasActiveOperationalAssignment ? (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          <div>
            <p className="font-bold text-emerald-200">
              Assigned Table Official Station Active
              {primaryAssignment?.court_name ? ` — ${primaryAssignment.court_name}` : ''}
            </p>
            <p className="text-slate-300 mt-0.5">
              Your operational authority is active for this tournament. You have live scoring and match execution permissions for your assigned station.
            </p>
          </div>
        </div>
      ) : null}

      {/* Tournament Status Alert */}
      {selectedTournament && selectedTournament.status !== 'ONGOING' && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-3">
          <Shield className="w-5 h-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-bold">Tournament status is currently {selectedTournament.status}.</p>
            <p className="text-slate-400 mt-0.5">
              Live court scoring and match assignments are typically executed during the <strong>ONGOING</strong> lifecycle phase following the Pre-Competition Lock.
            </p>
          </div>
        </div>
      )}

      {/* Engine Mode Tabs (Operations Center vs Full Contact vs Anyo Forms) */}
      <div className="flex flex-col sm:flex-row bg-slate-900 border border-slate-800 rounded-2xl p-1.5 w-full max-w-full sm:max-w-2xl lg:max-w-3xl shadow-lg gap-1">
        <button
          type="button"
          onClick={() => setCompetitionMode('OPERATIONS')}
          className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 min-w-0 ${
            competitionMode === 'OPERATIONS'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-4 h-4 shrink-0" />
          <span className="truncate hidden xl:inline">Operations Center (Live Command)</span>
          <span className="truncate xl:hidden">Operations Center</span>
        </button>
        <button
          type="button"
          onClick={() => setCompetitionMode('FULL_CONTACT')}
          className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 min-w-0 ${
            competitionMode === 'FULL_CONTACT'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span className="truncate">Full Contact ({courts.length} Courts)</span>
        </button>
        <button
          type="button"
          onClick={() => setCompetitionMode('ANYO')}
          className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 min-w-0 ${
            competitionMode === 'ANYO'
              ? 'bg-amber-400 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span className="truncate">Anyo Forms ({anyoEvents.length} Events)</span>
        </button>
      </div>

      {competitionMode === 'OPERATIONS' ? (
        /* O-37 Real-Time Court Operations Center */
        selectedTournament ? (
          <CourtOperationsCenter
            tournament={selectedTournament}
            snapshot={selectedSnapshot}
            canManage={isOfficialAuthorized}
            canScore={canRecordScores}
            onOpenScoringConsole={async (matchId, assignmentId) => {
              if (isResolvingConsole) return;
              setIsResolvingConsole(true);
              setError(null);

              try {
                // 1. Find matching court and assignment from state if available
                const activeAssignment = assignments.find((a) => a.id === assignmentId);
                let activeCourt = courts.find((c) => c.id === activeAssignment?.court_id);

                // 2. Resolve match object in order:
                // a. Existing hydrated activeAssignment.match (if id matches)
                let matchObj: Match | null =
                  activeAssignment?.match && activeAssignment.match.id === matchId
                    ? activeAssignment.match
                    : null;

                // b. Existing local match in assignableMatches
                if (!matchObj) {
                  matchObj = assignableMatches.find((m) => m.id === matchId) || null;
                }

                // c. If still unavailable (e.g. dynamically dispatched / LIVE match), fetch exact match by matchId
                if (!matchObj) {
                  const fetchedMatch = await scoringService.getMatchDetails(matchId);
                  if (fetchedMatch) {
                    matchObj = fetchedMatch;
                  }
                }

                // 3. Fallback resolution for activeCourt if activeAssignment was not loaded in parent state
                if (!activeCourt) {
                  if (activeAssignment?.court_id) {
                    activeCourt = courts.find((c) => c.id === activeAssignment.court_id);
                  }
                  if (!activeCourt && matchObj?.court_identifier) {
                    activeCourt = courts.find(
                      (c) =>
                        c.court_identifier === matchObj!.court_identifier ||
                        c.court_number?.toString() === matchObj!.court_identifier
                    );
                  }
                  if (!activeCourt && courts.length > 0) {
                    activeCourt = courts[0];
                  }
                }

                if (activeCourt && matchObj) {
                  setActiveScoringSession({
                    court: activeCourt,
                    match: matchObj,
                    assignmentId,
                  });
                } else {
                  setError('Unable to load match or court details for scoring. Please refresh court operations.');
                  await loadCourtData(selectedTournamentId);
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to open scoring console.';
                console.error('Error resolving scoring console:', err);
                setError(msg);
              } finally {
                setIsResolvingConsole(false);
              }
            }}
          />
        ) : (
          <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 text-xs">
            No tournament selected for Operations Center.
          </div>
        )
      ) : competitionMode === 'ANYO' ? (
        /* Anyo Competition Sessions Grid */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Anyo Category Events ({anyoEvents.length})
            </h2>
            <span className="text-xs text-slate-400">
              Judges Panel: <strong>5 or 7 Judges</strong> • Mode: <strong>Olympic Trim / Arithmetic Mean</strong>
            </span>
          </div>

          {anyoEvents.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 text-xs">
              No Anyo category events configured for this tournament yet. Create Anyo events in Tournament Management.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {anyoEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="flex flex-col justify-between bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl transition-all hover:border-slate-700"
                >
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {evt.category}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {evt.division}
                      </span>
                    </div>

                    <div className="my-4 space-y-2">
                      <h3 className="text-base font-bold text-slate-100">{evt.name}</h3>
                      <p className="text-xs text-slate-400">
                        Gender: <strong className="text-slate-200">{evt.gender}</strong> • Form Category
                      </p>
                      <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                        <div>• Linear Performance Order queue</div>
                        <div>• Server-side Olympic Trim scoring</div>
                        <div>• 3-Tier Tie Resolution Workflow</div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleOpenAnyoSession(evt)}
                      disabled={isLoadingAnyo}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-md transition-all min-h-[44px]"
                    >
                      <Play className="w-4 h-4 fill-slate-950" />
                      <span>{canRecordScores ? 'Open Scoring Console' : isOfficialAuthorized ? 'Oversight Session' : 'View Anyo Session'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Courts Overview Grid (Full Contact) */
        <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            Tournament Courts ({courts.length})
          </h2>
          <span className="text-xs text-slate-400">
            Assignable Scheduled Matches: <strong>{assignableMatches.length}</strong>
          </span>
        </div>

        {courts.length === 0 ? (
          <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 text-xs">
            No courts configured for this tournament yet. Create courts in Tournament Management.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courts.map((court) => {
              // Find active assignment for this court
              const activeAssignment = assignments.find(
                (a) => a.court_id === court.id && (a.status === 'LIVE' || a.status === 'ASSIGNED')
              );
              const activeMatch = activeAssignment?.match;
              const isLive = activeAssignment?.status === 'LIVE';
              const isAssigned = activeAssignment?.status === 'ASSIGNED';

              return (
                <div
                  key={court.id}
                  className={`flex flex-col justify-between bg-slate-900 border rounded-2xl p-5 shadow-xl transition-all ${
                    isLive
                      ? 'border-rose-500/60 ring-1 ring-rose-500/30'
                      : isAssigned
                      ? 'border-amber-500/50'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Court Header */}
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-mono font-bold text-xs text-slate-200">
                          {court.identifier}
                        </span>
                        <span className="font-bold text-slate-100 text-sm">{court.name}</span>
                      </div>

                      {isLive ? (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
                          <Radio className="w-3 h-3" /> LIVE
                        </span>
                      ) : isAssigned ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          QUEUED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400">
                          IDLE
                        </span>
                      )}
                    </div>

                    {/* Court Match Body */}
                    <div className="my-4">
                      {activeMatch ? (
                        <div className="space-y-3">
                          <div className="text-[11px] text-slate-400">
                            <span className="font-bold text-slate-300">
                              {activeMatch.event?.category} • {activeMatch.event?.division}
                            </span>
                            <p className="mt-0.5 font-mono">
                              {activeMatch.round_name || `Round ${activeMatch.round_number || 1}`} (Match #{activeMatch.match_number || 1})
                            </p>
                          </div>

                          {/* Dual Corner Athletes */}
                          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 line-clamp-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                                <span className="font-semibold text-slate-200">
                                  {activeMatch.red_registration?.user_profile?.full_name || 'Red Corner'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {activeMatch.red_registration?.team_name || ''}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 line-clamp-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                                <span className="font-semibold text-slate-200">
                                  {activeMatch.blue_registration?.user_profile?.full_name || 'Blue Corner'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {activeMatch.blue_registration?.team_name || ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-xs text-slate-500">
                          Court is currently idle with no active or queued match.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Court Footer Actions */}
                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    {isLive && activeMatch && activeAssignment ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() =>
                            setActiveScoringSession({
                              court,
                              match: activeMatch,
                              assignmentId: activeAssignment.id,
                            })
                          }
                          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-black text-white shadow-md transition-all min-h-[44px] ${
                            canRecordScores
                              ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-950'
                              : isOfficialAuthorized
                              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-950'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                        >
                          {canRecordScores ? (
                            <Radio className="w-3.5 h-3.5" />
                          ) : isOfficialAuthorized ? (
                            <Shield className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          {canRecordScores ? 'Scoring Console' : isOfficialAuthorized ? 'Oversight Console' : 'View Scoring'}
                        </button>
                        <button
                          onClick={() =>
                            setActiveScoreboardSession({
                              court,
                              match: activeMatch,
                            })
                          }
                          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold text-indigo-300 bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-700/50 transition-colors min-h-[44px]"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Scoreboard
                        </button>
                      </div>
                    ) : isAssigned && activeMatch && activeAssignment ? (
                      isOfficialAuthorized ? (
                        <button
                          onClick={() => handleStartMatch(court, activeAssignment)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-md transition-all min-h-[44px]"
                        >
                          <Play className="w-4 h-4 fill-slate-950" /> Start Match (Go LIVE)
                        </button>
                      ) : (
                        <div className="w-full py-2.5 px-4 rounded-xl text-center text-xs font-medium text-slate-400 bg-slate-800/60 border border-slate-700/60">
                          Match Queued (Awaiting Official)
                        </div>
                      )
                    ) : (
                      isOfficialAuthorized ? (
                        <button
                          onClick={() => {
                            setSelectedCourtForAssignment(court);
                            setSelectedMatchIdToAssign('');
                          }}
                          disabled={assignableMatches.length === 0}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors disabled:opacity-50 min-h-[44px]"
                        >
                          <Plus className="w-4 h-4 text-amber-400" /> Assign Match to Court
                        </button>
                      ) : (
                        <div className="w-full py-2.5 px-4 rounded-xl text-center text-xs font-medium text-slate-500 bg-slate-800/30 border border-slate-800">
                          Court Idle
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* ASSIGN MATCH MODAL */}
      {selectedCourtForAssignment && isOfficialAuthorized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-slate-100">
                  Assign Match to Court {selectedCourtForAssignment.identifier} ({selectedCourtForAssignment.name})
                </h3>
              </div>
              <button
                onClick={() => setSelectedCourtForAssignment(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                &times;
              </button>
            </div>

            <div>
              <label className="block text-xs uppercase font-bold text-slate-400 mb-2">
                Select Ready Match ({assignableMatches.length} available)
              </label>

              {assignableMatches.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No scheduled matches currently have both corners populated.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {assignableMatches.map((m) => {
                    const isSelected = selectedMatchIdToAssign === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMatchIdToAssign(m.id)}
                        className={`w-full p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30'
                            : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-200">
                            {m.event?.category} • {m.event?.division}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {m.round_name || `Round ${m.round_number || 1}`} • Match #{m.match_number || 1}
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-rose-300">
                            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                            <span className="line-clamp-1">
                              {m.red_registration?.user_profile?.full_name || 'Red Athlete'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-blue-300">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <span className="line-clamp-1">
                              {m.blue_registration?.user_profile?.full_name || 'Blue Athlete'}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedCourtForAssignment(null)}
                disabled={isAssigning}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignMatch}
                disabled={isAssigning || !selectedMatchIdToAssign}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-md transition-all disabled:opacity-50 min-h-[44px]"
              >
                {isAssigning ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUBLIC SCOREBOARD MODAL (Standalone viewer for any live court) */}
      {activeScoreboardSession && (
        <PublicScoreboardModal
          isOpen={true}
          onClose={() => setActiveScoreboardSession(null)}
          court={activeScoreboardSession.court}
          match={activeScoreboardSession.match}
          currentRound={1}
          timerSeconds={120}
          redScore={0}
          blueScore={0}
          redAdvantage={false}
          blueAdvantage={false}
          redFouls={0}
          blueFouls={0}
        />
      )}
    </div>
  );
};
