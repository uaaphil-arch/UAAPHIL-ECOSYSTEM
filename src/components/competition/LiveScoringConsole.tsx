import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trophy,
  RotateCcw,
  Play,
  Pause,
  Plus,
  Minus,
  Award,
  ShieldAlert,
  Save,
  CheckCircle2,
  XCircle,
  Radio,
  ExternalLink,
  ChevronLeft,
  Eye,
  AlertTriangle,
  Clock,
  WifiOff,
  FileText,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { scoringService } from '../../services/scoringService';
import { Court, Match, DecisionType, ScoringRound } from '../../types/tournament';
import { PublicScoreboardModal } from './PublicScoreboardModal';
import { formatRpcError } from '../../utils/rpcErrorFormatter';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { OperationalDiagnosticBar } from '../common/OperationalDiagnosticBar';
import { useAuth } from '../../context/AuthContext';

interface LiveScoringConsoleProps {
  match: Match;
  court: Court;
  assignmentId: string;
  isReadOnly?: boolean;
  onMatchCompleted: () => void;
  onBackToQueue: () => void;
}

type CornerColor = 'RED' | 'BLUE';

interface RoundScoreState {
  redScore: number;
  blueScore: number;
  redAdvantage: boolean;
  blueAdvantage: boolean;
  redFouls: number;
  blueFouls: number;
  winner?: CornerColor | null;
}

export interface ScoringLocalDraft {
  schemaVersion: number;
  userId: string;
  tournamentId: string;
  eventId: string;
  matchId: string;
  courtId: string;
  roundNumber: number;
  redScore: number;
  blueScore: number;
  redAdvantage: boolean;
  blueAdvantage: boolean;
  redFouls: number;
  blueFouls: number;
  winner?: CornerColor | null;
  capturedAt: string;
  ttlExpiresAt: string;
}

const ROUND_DURATION = 120; // 2 minutes standard
const DRAFT_SCHEMA_VERSION = 1;
const DRAFT_TTL_MS = 4 * 60 * 60 * 1000; // 4-hour TTL

// Scoped Storage Key helper (uaaphil_draft_v1_${userId}_${tournamentId}_${matchId}_round_${roundNumber})
const getDraftStorageKey = (
  userId: string,
  tournamentId: string,
  matchId: string,
  roundNumber: number
): string => `uaaphil_draft_v1_${userId}_${tournamentId}_${matchId}_round_${roundNumber}`;

const saveScoringDraft = (
  userId: string,
  tournamentId: string,
  eventId: string,
  matchId: string,
  courtId: string,
  roundNumber: number,
  state: RoundScoreState
) => {
  try {
    const now = Date.now();
    const draft: ScoringLocalDraft = {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      userId,
      tournamentId,
      eventId,
      matchId,
      courtId,
      roundNumber,
      redScore: state.redScore,
      blueScore: state.blueScore,
      redAdvantage: state.redAdvantage,
      blueAdvantage: state.blueAdvantage,
      redFouls: state.redFouls,
      blueFouls: state.blueFouls,
      winner: state.winner || null,
      capturedAt: new Date(now).toISOString(),
      ttlExpiresAt: new Date(now + DRAFT_TTL_MS).toISOString(),
    };
    sessionStorage.setItem(
      getDraftStorageKey(userId, tournamentId, matchId, roundNumber),
      JSON.stringify(draft)
    );
  } catch (err) {
    console.warn('Failed to save scoring draft to sessionStorage:', err);
  }
};

const getScoringDraft = (
  userId: string,
  tournamentId: string,
  matchId: string,
  courtId: string,
  roundNumber: number
): ScoringLocalDraft | null => {
  try {
    const key = getDraftStorageKey(userId, tournamentId, matchId, roundNumber);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScoringLocalDraft;

    // Fail closed on malformed draft
    if (
      !parsed ||
      parsed.schemaVersion !== DRAFT_SCHEMA_VERSION ||
      parsed.userId !== userId ||
      parsed.tournamentId !== tournamentId ||
      parsed.matchId !== matchId ||
      parsed.courtId !== courtId ||
      parsed.roundNumber !== roundNumber ||
      typeof parsed.redScore !== 'number' ||
      typeof parsed.blueScore !== 'number'
    ) {
      sessionStorage.removeItem(key);
      return null;
    }

    // TTL check (4 hours)
    if (new Date(parsed.ttlExpiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const clearScoringDraft = (
  userId: string,
  tournamentId: string,
  matchId: string,
  roundNumber?: number
) => {
  try {
    if (roundNumber !== undefined) {
      sessionStorage.removeItem(getDraftStorageKey(userId, tournamentId, matchId, roundNumber));
    } else {
      [1, 2, 3].forEach((r) => {
        sessionStorage.removeItem(getDraftStorageKey(userId, tournamentId, matchId, r));
      });
    }
  } catch {
    // Ignore storage clear errors
  }
};

export const LiveScoringConsole: React.FC<LiveScoringConsoleProps> = ({
  match,
  court,
  assignmentId,
  isReadOnly = false,
  onMatchCompleted,
  onBackToQueue,
}) => {
  const { user } = useAuth();
  const userId = user?.id || 'official_operator';
  const tournamentId = match.tournament_id || court.tournament_id || 'unknown_tournament';

  const { isOnline, isReconnecting } = useNetworkStatus();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => new Date());
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [timerSeconds, setTimerSeconds] = useState<number>(ROUND_DURATION);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce & Serialization Refs for Live Scoring Write-Safety (FIND-029)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingScoreRef = useRef<{ roundNum: number; state: RoundScoreState; isFinal?: boolean } | null>(null);
  const activePersistPromiseRef = useRef<Promise<boolean> | null>(null);

  // Per-round local state initialized from match rounds
  const [roundScores, setRoundScores] = useState<Record<number, RoundScoreState>>({
    1: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
    2: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
    3: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
  });

  // Operator-Controlled Draft Recovery State
  const [availableDrafts, setAvailableDrafts] = useState<Record<number, ScoringLocalDraft>>({});
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [selectedWinnerCorner, setSelectedWinnerCorner] = useState<CornerColor | 'DRAW'>('RED');
  const [selectedDecision, setSelectedDecision] = useState<DecisionType>('POINTS');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPublicScoreboard, setShowPublicScoreboard] = useState<boolean>(false);

  // Check for UAAPHIL Novice Override: (Ruleset === 'Full Contact UAAPHIL Rules' and Level === 'NOVICE')
  const isNoviceUaaphil =
    match.event?.category === 'Full Contact UAAPHIL Rules' &&
    (match.event?.rules_override?.level === 'NOVICE' ||
      (typeof match.event?.division === 'string' && match.event.division.toUpperCase().includes('NOVICE')));

  // Authoritative Check for Local Drafts (INV-01: Zero Auto-Replay; Operator Review Required)
  const checkForLocalDrafts = useCallback(async () => {
    if (isReadOnly) return;

    let latestMatch: Match | null = null;
    let authoritativeRounds: ScoringRound[] = [];

    try {
      const [fetchedMatch, fetchedRounds] = await Promise.all([
        scoringService.getMatchDetails(match.id),
        scoringService.getScoringRounds(match.id),
      ]);
      latestMatch = fetchedMatch;
      authoritativeRounds = fetchedRounds;
    } catch (err) {
      console.warn('Authoritative match refetch during draft inspection:', err);
    }

    // Step 3 Validation: If match is terminal in database, purge drafts
    if (latestMatch && (latestMatch.status === 'COMPLETED' || latestMatch.status === 'CANCELLED')) {
      clearScoringDraft(userId, tournamentId, match.id);
      setAvailableDrafts({});
      setConflictNotice(`Match is ${latestMatch.status} on server. Stale local draft was discarded.`);
      return;
    }

    const detected: Record<number, ScoringLocalDraft> = {};
    const serverRoundMap = new Map(authoritativeRounds.map((r) => [r.round_number, r]));

    [1, 2, 3].forEach((roundNum) => {
      const draft = getScoringDraft(userId, tournamentId, match.id, court.id, roundNum);
      if (!draft) return;

      const serverRound = serverRoundMap.get(roundNum);
      if (serverRound && serverRound.is_confirmed) {
        // Step 4: Authoritative confirmed score exists on server -> discard conflicting local draft
        clearScoringDraft(userId, tournamentId, match.id, roundNum);
        setConflictNotice(`Round ${roundNum} score was confirmed by another official. Local draft discarded.`);
        return;
      }

      // Check if draft contains uncommitted point modifications differing from current state
      const currentScore = roundScores[roundNum];
      if (
        !currentScore ||
        currentScore.redScore !== draft.redScore ||
        currentScore.blueScore !== draft.blueScore ||
        currentScore.redAdvantage !== draft.redAdvantage ||
        currentScore.blueAdvantage !== draft.blueAdvantage
      ) {
        detected[roundNum] = draft;
      }
    });

    setAvailableDrafts(detected);
  }, [isReadOnly, match.id, court.id, userId, tournamentId, roundScores]);

  // Hydrate Initial State from Authoritative Database
  useEffect(() => {
    const updated: Record<number, RoundScoreState> = {
      1: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
      2: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
      3: { redScore: 0, blueScore: 0, redAdvantage: false, blueAdvantage: false, redFouls: 0, blueFouls: 0, winner: null },
    };

    if (match.rounds && match.rounds.length > 0) {
      match.rounds.forEach((r) => {
        if (r.round_number >= 1 && r.round_number <= 3) {
          updated[r.round_number] = {
            redScore: r.red_score || 0,
            blueScore: r.blue_score || 0,
            redAdvantage: r.red_advantage || false,
            blueAdvantage: r.blue_advantage || false,
            redFouls: 0,
            blueFouls: 0,
            winner: r.winner_corner as CornerColor | null,
          };
        }
      });
    }

    setRoundScores(updated);
  }, [match]);

  // Check for local drafts on mount and when connection restores (INV-01: Zero Auto-Replay)
  useEffect(() => {
    if (isOnline) {
      checkForLocalDrafts();
    }
  }, [isOnline, checkForLocalDrafts]);

  const activeRoundData = roundScores[currentRound] || {
    redScore: 0,
    blueScore: 0,
    redAdvantage: false,
    blueAdvantage: false,
    redFouls: 0,
    blueFouls: 0,
    winner: null,
  };

  /**
   * Helper: Computes the definitive winner of a round according to Arnis Section 6 rules.
   * If points are tied, requires Advantage point. If tied without advantage, returns null.
   */
  const computeRoundWinner = (r: RoundScoreState): CornerColor | null => {
    if (r.redScore > r.blueScore) return 'RED';
    if (r.blueScore > r.redScore) return 'BLUE';
    // Tied in points: evaluate Advantage point
    if (r.redAdvantage && !r.blueAdvantage) return 'RED';
    if (r.blueAdvantage && !r.redAdvantage) return 'BLUE';
    return null; // Tied without advantage resolution
  };

  const r1Winner = computeRoundWinner(roundScores[1]);
  const r2Winner = computeRoundWinner(roundScores[2]);
  const r3Winner = computeRoundWinner(roundScores[3]);

  const redRoundsWon = [r1Winner, r2Winner, r3Winner].filter((w) => w === 'RED').length;
  const blueRoundsWon = [r1Winner, r2Winner, r3Winner].filter((w) => w === 'BLUE').length;

  // Auto-Termination Rule: Match ends early if one fighter wins Rounds 1 & 2 consecutively (2-0)
  const isMatchDecidedAfterRound2 =
    (r1Winner === 'RED' && r2Winner === 'RED') ||
    (r1Winner === 'BLUE' && r2Winner === 'BLUE');

  // Cumulative Point Totals for display
  const totalRedScore = (Object.values(roundScores) as RoundScoreState[]).reduce((acc, r) => acc + r.redScore, 0);
  const totalBlueScore = (Object.values(roundScores) as RoundScoreState[]).reduce((acc, r) => acc + r.blueScore, 0);

  // Timer Interval Effect
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            setIsTimerRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  // Debounce & Serialization Helpers for Live Scoring Write-Safety (FIND-029)
  const executePendingPersistence = async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (activePersistPromiseRef.current) {
      try {
        await activePersistPromiseRef.current;
      } catch {
        // Continue to execute pending task
      }
    }

    if (!pendingScoreRef.current || isReadOnly) {
      return true;
    }

    // When offline, preserve draft locally and do NOT execute network mutation
    if (!isOnline) {
      const task = pendingScoreRef.current;
      pendingScoreRef.current = null;
      saveScoringDraft(
        userId,
        tournamentId,
        match.event_id || '',
        match.id,
        court.id,
        task.roundNum,
        task.state
      );
      setSaveStatus('Offline Draft Preserved');
      return false;
    }

    const task = pendingScoreRef.current;
    pendingScoreRef.current = null;

    const runPersist = async (): Promise<boolean> => {
      try {
        setSaveStatus('Saving...');
        const roundWinner = computeRoundWinner(task.state);
        await scoringService.recordRoundScore(
          match.id,
          task.roundNum,
          task.state.redScore,
          task.state.blueScore,
          task.state.redAdvantage,
          task.state.blueAdvantage,
          roundWinner,
          task.isFinal || false
        );
        // Successful authoritative persistence: Purge local draft for this round
        clearScoringDraft(userId, tournamentId, match.id, task.roundNum);
        setSaveStatus('Saved');
        setLastSyncedAt(new Date());
        setTimeout(() => setSaveStatus(null), 1500);
        return true;
      } catch (err: unknown) {
        console.error('Failed to persist round score:', err);
        setSaveStatus('Sync error — Draft Preserved');
        // Preserve local draft, but DO NOT re-queue for automatic background replay
        saveScoringDraft(
          userId,
          tournamentId,
          match.event_id || '',
          match.id,
          court.id,
          task.roundNum,
          task.state
        );
        return false;
      } finally {
        activePersistPromiseRef.current = null;
      }
    };

    const promise = runPersist();
    activePersistPromiseRef.current = promise;
    const ok = await promise;

    // If another rapid click occurred while async call was in flight, execute sequentially
    if (pendingScoreRef.current) {
      return await executePendingPersistence();
    }
    return ok;
  };

  // Trailing Debounce Trigger (300ms)
  const persistScoreDebounced = (updatedRound: RoundScoreState, roundNum: number) => {
    if (isReadOnly) return;
    pendingScoreRef.current = {
      roundNum,
      state: updatedRound,
      isFinal: false,
    };
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      executePendingPersistence();
    }, 300);
  };

  // Immediate Awaited Flush Helper
  const flushPendingScore = async (markAsFinal: boolean = false): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingScoreRef.current && markAsFinal) {
      pendingScoreRef.current.isFinal = true;
    }
    return await executePendingPersistence();
  };

  // Best-effort unmount cleanup: Preserves local draft without unmanaged background network calls
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingScoreRef.current && !isReadOnly) {
        const task = pendingScoreRef.current;
        pendingScoreRef.current = null;
        saveScoringDraft(
          userId,
          tournamentId,
          match.event_id || '',
          match.id,
          court.id,
          task.roundNum,
          task.state
        );
      }
    };
  }, [match.id, match.event_id, court.id, userId, tournamentId, isReadOnly]);

  // Score Modification Handlers
  const updateActiveRound = (updater: (prev: RoundScoreState) => RoundScoreState) => {
    if (isReadOnly) return;
    setRoundScores((prev) => {
      const current = prev[currentRound] || {
        redScore: 0,
        blueScore: 0,
        redAdvantage: false,
        blueAdvantage: false,
        redFouls: 0,
        blueFouls: 0,
        winner: null,
      };
      const updated = updater(current);

      // 1. Immediately preserve structured local draft to sessionStorage
      saveScoringDraft(
        userId,
        tournamentId,
        match.event_id || '',
        match.id,
        court.id,
        currentRound,
        updated
      );

      // 2. If online, trigger debounced network write; otherwise show offline status
      if (isOnline) {
        persistScoreDebounced(updated, currentRound);
      } else {
        setSaveStatus('Draft Saved Locally (Offline)');
      }

      return {
        ...prev,
        [currentRound]: updated,
      };
    });
  };

  // Operator-Controlled Recovery Actions (INV-01 Compliant: Loads into UI only, zero mutation RPC)
  const handleRecoverDraft = (roundNum: number) => {
    const draft = availableDrafts[roundNum];
    if (!draft) return;

    setRoundScores((prev) => ({
      ...prev,
      [roundNum]: {
        redScore: draft.redScore,
        blueScore: draft.blueScore,
        redAdvantage: draft.redAdvantage,
        blueAdvantage: draft.blueAdvantage,
        redFouls: draft.redFouls,
        blueFouls: draft.blueFouls,
        winner: draft.winner || null,
      },
    }));

    setSaveStatus('Draft Loaded into Console (Unsaved)');
    setAvailableDrafts((prev) => {
      const next = { ...prev };
      delete next[roundNum];
      return next;
    });
  };

  const handleDiscardDraft = (roundNum: number) => {
    clearScoringDraft(userId, tournamentId, match.id, roundNum);
    setAvailableDrafts((prev) => {
      const next = { ...prev };
      delete next[roundNum];
      return next;
    });
  };

  // Awaited Round Switch Handler
  const handleSwitchRound = async (targetRound: number) => {
    if (targetRound === currentRound) return;
    setErrorMessage(null);
    if (pendingScoreRef.current && isOnline) {
      const success = await flushPendingScore();
      if (!success) {
        setErrorMessage('Could not sync current round score to backend. Please check network connection before switching rounds.');
        return;
      }
    }
    setCurrentRound(targetRound);
    setTimerSeconds(ROUND_DURATION);
    setIsTimerRunning(false);
  };

  const handleScoreChange = (corner: CornerColor, delta: number) => {
    updateActiveRound((prev) => {
      if (corner === 'RED') {
        return { ...prev, redScore: Math.max(0, prev.redScore + delta) };
      } else {
        return { ...prev, blueScore: Math.max(0, prev.blueScore + delta) };
      }
    });
  };

  const handleAdvantageToggle = (corner: CornerColor) => {
    updateActiveRound((prev) => {
      if (corner === 'RED') {
        const nextRed = !prev.redAdvantage;
        return { ...prev, redAdvantage: nextRed, blueAdvantage: nextRed ? false : prev.blueAdvantage };
      } else {
        const nextBlue = !prev.blueAdvantage;
        return { ...prev, blueAdvantage: nextBlue, redAdvantage: nextBlue ? false : prev.redAdvantage };
      }
    });
  };

  const handleFoulChange = (corner: CornerColor, delta: number) => {
    updateActiveRound((prev) => {
      if (corner === 'RED') {
        return { ...prev, redFouls: Math.max(0, prev.redFouls + delta) };
      } else {
        return { ...prev, blueFouls: Math.max(0, prev.blueFouls + delta) };
      }
    });
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Open Finalize Dialog with Strict Invariant Verification
  const handleOpenFinalizeModal = () => {
    setErrorMessage(null);

    // P5-04 Offline Guard: Never allow opening finalization if offline
    if (!isOnline) {
      setErrorMessage('Cannot finalize match while offline. Please verify network connectivity before submitting match completion.');
      return;
    }

    // Invariant: If Novice UAAPHIL rules apply
    if (isNoviceUaaphil) {
      if (!r1Winner) {
        setErrorMessage('Round 1 is tied. Please select an Advantage point for Red or Blue before finalizing.');
        return;
      }
      if (!r2Winner) {
        setErrorMessage('Round 2 is tied. Please select an Advantage point for Red or Blue before finalizing.');
        return;
      }

      if (redRoundsWon > blueRoundsWon) {
        setSelectedWinnerCorner('RED');
      } else if (blueRoundsWon > redRoundsWon) {
        setSelectedWinnerCorner('BLUE');
      } else {
        // Draw outcome permitted for Novice
        setSelectedWinnerCorner('DRAW');
      }
      setShowCompleteModal(true);
      return;
    }

    // Standard Match Rules:
    // If decided 2-0 after Round 2
    if (isMatchDecidedAfterRound2) {
      setSelectedWinnerCorner(r1Winner === 'RED' ? 'RED' : 'BLUE');
      setShowCompleteModal(true);
      return;
    }

    // If 1-1 split after Round 2, Round 3 is mandatory
    if (r1Winner && r2Winner && r1Winner !== r2Winner && !r3Winner) {
      setErrorMessage('Match is tied 1-1 after Round 2. Round 3 is required as the decision round.');
      return;
    }

    // Check tie in active round
    if (!computeRoundWinner(activeRoundData)) {
      setErrorMessage(`Round ${currentRound} is tied on points. You must assign an Advantage Point to resolve the round winner.`);
      return;
    }

    // Determine leading fighter by rounds won
    if (redRoundsWon > blueRoundsWon) {
      setSelectedWinnerCorner('RED');
    } else if (blueRoundsWon > redRoundsWon) {
      setSelectedWinnerCorner('BLUE');
    } else {
      // Tie breaker based on total points or active advantage
      if (totalRedScore > totalBlueScore) setSelectedWinnerCorner('RED');
      else if (totalBlueScore > totalRedScore) setSelectedWinnerCorner('BLUE');
      else setSelectedWinnerCorner('RED');
    }

    setShowCompleteModal(true);
  };

  // Authoritative Completion via RPC
  const handleConfirmCompletion = async () => {
    if (!isOnline) {
      setErrorMessage('Cannot complete match while offline. Please verify network connectivity.');
      return;
    }

    if (selectedWinnerCorner === 'DRAW') {
      if (!isNoviceUaaphil) {
        setErrorMessage('Draw is only permitted for UAAPHIL Novice division matches.');
        return;
      }
      // For Draw, finalize match with draw note
      try {
        setIsSubmitting(true);
        setErrorMessage(null);

        // Await immediate flush of pending debounced score before finalization
        const flushOk = await flushPendingScore(true);
        if (!flushOk) {
          setErrorMessage('Failed to save latest round score prior to finalization. Match was not finalized. Please retry.');
          setIsSubmitting(false);
          return;
        }

        // Complete using red athlete or authorized draw
        await scoringService.completeCourtMatch(
          match.id,
          match.red_corner_registration_id!,
          selectedDecision
        );
        clearScoringDraft(userId, tournamentId, match.id);
        setShowCompleteModal(false);
        onMatchCompleted();
      } catch (err: unknown) {
        setErrorMessage(formatRpcError(err));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const winnerRegistrationId =
      selectedWinnerCorner === 'RED'
        ? match.red_corner_registration_id
        : match.blue_corner_registration_id;

    if (!winnerRegistrationId) {
      setErrorMessage('Selected corner does not have an assigned athlete.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      // 1. Await immediate flush of pending debounced score before finalization
      const flushOk = await flushPendingScore(true);
      if (!flushOk) {
        setErrorMessage('Failed to save latest round score prior to finalization. Match was not finalized. Please retry.');
        setIsSubmitting(false);
        return;
      }

      // Explicitly confirm current round score with final flag in backend
      const roundWinner = computeRoundWinner(activeRoundData);
      await scoringService.recordRoundScore(
        match.id,
        currentRound,
        activeRoundData.redScore,
        activeRoundData.blueScore,
        activeRoundData.redAdvantage,
        activeRoundData.blueAdvantage,
        roundWinner,
        true
      );

      // 2. Complete Match via authoritative RPC
      await scoringService.completeCourtMatch(
        match.id,
        winnerRegistrationId,
        selectedDecision
      );

      // Clear all local scoring drafts for this completed match
      clearScoringDraft(userId, tournamentId, match.id);

      setShowCompleteModal(false);
      onMatchCompleted();
    } catch (err: unknown) {
      console.error('Finalize match error:', err);
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAssignment = async () => {
    if (!isOnline) {
      setErrorMessage('Cannot re-queue match while offline. Please verify network connectivity.');
      return;
    }

    try {
      setIsSubmitting(true);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingScoreRef.current = null;
      await scoringService.cancelMatchAssignment(assignmentId, cancelReason);
      clearScoringDraft(userId, tournamentId, match.id);
      setShowCancelModal(false);
      onBackToQueue();
    } catch (err: unknown) {
      console.error('Cancel assignment error:', err);
      setErrorMessage(formatRpcError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const redAthleteName = match.red_registration?.user_profile?.full_name || 'Red Corner Athlete';
  const blueAthleteName = match.blue_registration?.user_profile?.full_name || 'Blue Corner Athlete';

  const activeDraft = availableDrafts[currentRound];

  return (
    <div className="space-y-6">
      {/* P5-04: Operational Diagnostic & Connectivity Status */}
      <OperationalDiagnosticBar
        isOnline={isOnline}
        syncStatus={!isOnline ? 'OFFLINE' : saveStatus?.includes('error') ? 'SYNC_ERROR' : saveStatus === 'Saving...' ? 'SYNCHRONIZING' : 'SYNCED'}
        lastSyncedAt={lastSyncedAt}
        contextLabel={`Court Ring: ${court.identifier}`}
        compact
      />

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="p-4 bg-rose-950/90 border-2 border-rose-600 rounded-xl flex items-center justify-between gap-3 text-rose-200 text-xs shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <strong className="text-rose-100 text-sm font-bold block">OFFLINE — LOCAL DRAFT PRESERVATION ACTIVE</strong>
              <span>Point changes are safely stored in browser session drafts. Reconnection will NEVER auto-submit scores; operator review is strictly required.</span>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded bg-rose-900 border border-rose-700 text-rose-200 font-mono text-[11px] shrink-0 font-bold">
            Offline Mode
          </span>
        </div>
      )}

      {/* Conflict / Stale Discard Notice Banner */}
      {conflictNotice && (
        <div className="p-3 bg-amber-950/80 border border-amber-600 rounded-xl flex items-center justify-between gap-2 text-amber-200 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{conflictNotice}</span>
          </div>
          <button
            onClick={() => setConflictNotice(null)}
            className="text-amber-400 hover:text-white font-bold text-xs px-2 py-0.5 rounded bg-amber-900/60"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* OPERATOR-CONTROLLED DRAFT RECOVERY BANNER (INV-01) */}
      {activeDraft && (
        <div className="p-4 bg-indigo-950/90 border-2 border-indigo-500 rounded-2xl shadow-xl space-y-3 text-indigo-100 animate-in fade-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-white">
                  Local Unsaved Scoring Draft Available (Round {activeDraft.roundNumber})
                </h4>
                <p className="text-xs text-indigo-300 mt-0.5">
                  Captured locally at {new Date(activeDraft.capturedAt).toLocaleTimeString()}. This draft has <strong>NOT</strong> been submitted to PostgreSQL.
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-indigo-900 border border-indigo-700 text-indigo-200 font-mono text-[11px] font-bold">
              Draft Found
            </span>
          </div>

          <div className="p-3 bg-indigo-900/50 rounded-xl border border-indigo-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <span className="font-mono">
                <strong className="text-red-400">Red: {activeDraft.redScore} pts</strong>
                {activeDraft.redAdvantage && <span className="ml-1 text-amber-400 font-bold">(Adv)</span>}
              </span>
              <span className="text-indigo-400">•</span>
              <span className="font-mono">
                <strong className="text-blue-400">Blue: {activeDraft.blueScore} pts</strong>
                {activeDraft.blueAdvantage && <span className="ml-1 text-amber-400 font-bold">(Adv)</span>}
              </span>
            </div>
            <span className="text-[11px] text-indigo-300 font-mono">
              TTL Expires: {new Date(activeDraft.ttlExpiresAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleDiscardDraft(activeDraft.roundNumber)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 transition-colors min-h-[38px]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Discard Draft
            </button>
            <button
              type="button"
              onClick={() => handleRecoverDraft(activeDraft.roundNumber)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-md shadow-amber-500/20 transition-all min-h-[38px]"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Review & Load into Console
            </button>
          </div>
        </div>
      )}

      {/* Top Action & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onBackToQueue}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0"
            title="Back to Court Queue"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse shrink-0">
                <Radio className="w-3.5 h-3.5" /> LIVE ON {court.identifier}
              </span>
              <span className="text-slate-200 font-bold text-sm truncate">
                {court.name}
              </span>
              {isReadOnly && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-amber-300 border border-amber-500/30 shrink-0">
                  <Eye className="w-3 h-3" /> READ-ONLY / SPECTATOR
                </span>
              )}
              {saveStatus && (
                <span className="flex items-center gap-1 text-[10px] text-slate-400 font-mono shrink-0">
                  <Save className="w-3 h-3 text-amber-400 animate-pulse" /> {saveStatus}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 break-words">
              {match.event?.category} • {match.event?.division} • {match.round_name || `Round ${match.round_number || 1}`} (Match #{match.match_number || 1})
              {isNoviceUaaphil && (
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-700/50 inline-block">
                  Novice (2-Round Rule)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowPublicScoreboard(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-colors min-h-[44px]"
          >
            <ExternalLink className="w-4 h-4" /> Open Live Scoreboard
          </button>
          {!isReadOnly && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 border border-slate-700/60 transition-colors min-h-[44px]"
            >
              <XCircle className="w-4 h-4" /> Re-queue Match
            </button>
          )}
        </div>
      </div>

      {/* Auto-Termination Banner */}
      {isMatchDecidedAfterRound2 && !isNoviceUaaphil && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-200">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="break-words">
              <strong>Match Decided (2-0):</strong> {r1Winner === 'RED' ? redAthleteName : blueAthleteName} won Rounds 1 and 2 consecutively. Round 3 is not required.
            </span>
          </div>
          <button
            onClick={handleOpenFinalizeModal}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg shrink-0 min-h-[38px]"
          >
            Finalize Now
          </button>
        </div>
      )}

      {/* Error / Validation Warning */}
      {errorMessage && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-lg flex items-center gap-2 text-rose-200 text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="break-words">{errorMessage}</span>
        </div>
      )}

      {/* Main Console Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* RED CORNER CONTROLLER */}
        <div className="lg:col-span-5 flex flex-col bg-slate-900 border-2 border-rose-600/60 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden min-w-0">
          <div className="flex items-center justify-between pb-4 border-b border-rose-900/40 gap-2 flex-wrap">
            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-rose-600 text-white shadow-md shrink-0">
              RED CORNER
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-rose-300/80 font-mono">
                Rounds Won: <strong className="text-rose-100 text-sm font-bold">{redRoundsWon}</strong>
              </span>
              <span className="text-xs text-slate-400 font-mono">
                (Pts: {totalRedScore})
              </span>
            </div>
          </div>

          <div className="my-4 min-w-0">
            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-100 line-clamp-2 sm:line-clamp-1 break-words">
              {redAthleteName}
            </h3>
            <p className="text-xs font-semibold text-rose-300/80 mt-0.5 truncate" title={match.red_registration?.team_name || 'Independent / Team Red'}>
              {match.red_registration?.team_name || 'Independent / Team Red'}
            </p>
          </div>

          {/* Active Round Score Display */}
          <div className="flex flex-col items-center justify-center my-4 py-6 bg-rose-950/30 border border-rose-800/40 rounded-xl">
            <span className="text-xs uppercase font-bold tracking-widest text-rose-400 mb-1">
              Round {currentRound} Score
            </span>
            <span className="font-mono text-6xl font-black text-rose-100">
              {activeRoundData.redScore}
            </span>
            {activeRoundData.redAdvantage && (
              <span className="mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
                Advantage Assigned
              </span>
            )}
          </div>

          {/* Scoring Buttons */}
          <div className="space-y-3 mt-auto">
            {!isReadOnly ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleScoreChange('RED', 1)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all shadow-md shadow-rose-950 min-h-[48px]"
                  >
                    <Plus className="w-5 h-5" /> +1 Point
                  </button>
                  <button
                    onClick={() => handleScoreChange('RED', -1)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-700/60 active:scale-95 transition-all min-h-[48px]"
                  >
                    <Minus className="w-5 h-5" /> -1 Point
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => handleAdvantageToggle('RED')}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold border transition-colors min-h-[44px] ${
                      activeRoundData.redAdvantage
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-extrabold shadow-lg shadow-amber-500/30'
                        : 'bg-slate-800/80 text-amber-300/80 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <Award className="w-4 h-4" /> Advantage
                  </button>
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs min-h-[44px]">
                    <div className="flex items-center gap-1 text-slate-400">
                      <ShieldAlert className="w-4 h-4 text-rose-400" />
                      <span>Fouls: <strong className="text-white">{activeRoundData.redFouls}</strong></span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleFoulChange('RED', 1)}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleFoulChange('RED', -1)}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-3 px-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                Operator scoring controls disabled in Spectator Mode.
              </div>
            )}
          </div>
        </div>

        {/* CENTER CONTROLS & TIMER */}
        <div className="lg:col-span-2 flex flex-col justify-between items-center bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-6">
          {/* Round Selector */}
          <div className="w-full">
            <span className="block text-center text-xs uppercase font-bold tracking-widest text-slate-400 mb-2">
              Select Round
            </span>
            <div className={`grid ${isNoviceUaaphil ? 'grid-cols-2' : 'grid-cols-3'} gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800`}>
              {(isNoviceUaaphil ? [1, 2] : [1, 2, 3]).map((r) => {
                const roundWinner = computeRoundWinner(roundScores[r]);
                const isR3Disabled = r === 3 && (isNoviceUaaphil || isMatchDecidedAfterRound2);
                const hasDraftForRound = Boolean(availableDrafts[r]);

                return (
                  <button
                    key={r}
                    disabled={isR3Disabled}
                    onClick={() => handleSwitchRound(r)}
                    className={`py-2 text-xs font-black rounded-md transition-all relative ${
                      currentRound === r
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : isR3Disabled
                        ? 'opacity-30 cursor-not-allowed text-slate-600'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    R{r}
                    {roundWinner && (
                      <span
                        className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                          roundWinner === 'RED' ? 'bg-rose-500' : 'bg-blue-500'
                        }`}
                      />
                    )}
                    {hasDraftForRound && (
                      <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Round Outcome Status */}
            <div className="mt-2 text-center">
              <span className="text-[10px] text-slate-400">
                R1: <strong className={r1Winner === 'RED' ? 'text-rose-400' : r1Winner === 'BLUE' ? 'text-blue-400' : 'text-slate-500'}>{r1Winner || 'Tied'}</strong>
                {' • '}
                R2: <strong className={r2Winner === 'RED' ? 'text-rose-400' : r2Winner === 'BLUE' ? 'text-blue-400' : 'text-slate-500'}>{r2Winner || 'Tied'}</strong>
                {!isNoviceUaaphil && (
                  <>
                    {' • '}
                    R3: <strong className={r3Winner === 'RED' ? 'text-rose-400' : r3Winner === 'BLUE' ? 'text-blue-400' : 'text-slate-500'}>{isMatchDecidedAfterRound2 ? 'N/A' : (r3Winner || 'Pending')}</strong>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Round Timer Display */}
          <div className="flex flex-col items-center w-full my-auto py-4">
            <div className="flex items-center gap-1 text-slate-400 text-xs uppercase tracking-widest font-bold mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Round Timer
            </div>
            <div className="font-mono text-4xl font-black text-amber-400 tracking-wider">
              {formatTimer(timerSeconds)}
            </div>

            {!isReadOnly && (
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setIsTimerRunning(!isTimerRunning)}
                  className={`p-3 rounded-full font-bold shadow-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center ${
                    isTimerRunning
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                  title={isTimerRunning ? 'Pause Timer' : 'Start Timer'}
                >
                  {isTimerRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <button
                  onClick={() => {
                    setIsTimerRunning(false);
                    setTimerSeconds(ROUND_DURATION);
                  }}
                  className="p-3 rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Reset Timer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Finalize Button */}
          <div className="w-full pt-4 border-t border-slate-800">
            {!isReadOnly ? (
              <button
                onClick={handleOpenFinalizeModal}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-black text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 shadow-xl shadow-amber-500/20 active:scale-95 transition-all min-h-[48px]"
              >
                <Trophy className="w-5 h-5" /> Finalize Match
              </button>
            ) : (
              <div className="text-center text-[10px] text-slate-500">
                Awaiting Official Result
              </div>
            )}
          </div>
        </div>

        {/* BLUE CORNER CONTROLLER */}
        <div className="lg:col-span-5 flex flex-col bg-slate-900 border-2 border-blue-600/60 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden min-w-0">
          <div className="flex items-center justify-between pb-4 border-b border-blue-900/40 gap-2 flex-wrap">
            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-blue-600 text-white shadow-md shrink-0">
              BLUE CORNER
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-blue-300/80 font-mono">
                Rounds Won: <strong className="text-blue-100 text-sm font-bold">{blueRoundsWon}</strong>
              </span>
              <span className="text-xs text-slate-400 font-mono">
                (Pts: {totalBlueScore})
              </span>
            </div>
          </div>

          <div className="my-4 min-w-0">
            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-100 line-clamp-2 sm:line-clamp-1 break-words">
              {blueAthleteName}
            </h3>
            <p className="text-xs font-semibold text-blue-300/80 mt-0.5 truncate" title={match.blue_registration?.team_name || 'Independent / Team Blue'}>
              {match.blue_registration?.team_name || 'Independent / Team Blue'}
            </p>
          </div>

          {/* Active Round Score Display */}
          <div className="flex flex-col items-center justify-center my-4 py-6 bg-blue-950/30 border border-blue-800/40 rounded-xl">
            <span className="text-xs uppercase font-bold tracking-widest text-blue-400 mb-1">
              Round {currentRound} Score
            </span>
            <span className="font-mono text-6xl font-black text-blue-100">
              {activeRoundData.blueScore}
            </span>
            {activeRoundData.blueAdvantage && (
              <span className="mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
                Advantage Assigned
              </span>
            )}
          </div>

          {/* Scoring Buttons */}
          <div className="space-y-3 mt-auto">
            {!isReadOnly ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleScoreChange('BLUE', 1)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-md shadow-blue-950 min-h-[48px]"
                  >
                    <Plus className="w-5 h-5" /> +1 Point
                  </button>
                  <button
                    onClick={() => handleScoreChange('BLUE', -1)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-blue-300 bg-blue-950/60 hover:bg-blue-900/80 border border-blue-700/60 active:scale-95 transition-all min-h-[48px]"
                  >
                    <Minus className="w-5 h-5" /> -1 Point
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => handleAdvantageToggle('BLUE')}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold border transition-colors min-h-[44px] ${
                      activeRoundData.blueAdvantage
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-extrabold shadow-lg shadow-amber-500/30'
                        : 'bg-slate-800/80 text-amber-300/80 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <Award className="w-4 h-4" /> Advantage
                  </button>
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs min-h-[44px]">
                    <div className="flex items-center gap-1 text-slate-400">
                      <ShieldAlert className="w-4 h-4 text-blue-400" />
                      <span>Fouls: <strong className="text-white">{activeRoundData.blueFouls}</strong></span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleFoulChange('BLUE', 1)}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleFoulChange('BLUE', -1)}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-3 px-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                Operator scoring controls disabled in Spectator Mode.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DOUBLE-CONFIRMATION FINALIZE MODAL */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-bold text-slate-100">Declare Official Winner</h3>
              </div>
              <button
                onClick={() => setShowCompleteModal(false)}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                &times;
              </button>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Winner Corner Selection */}
            <div>
              <label className="block text-xs uppercase font-bold text-slate-400 mb-2">
                Winning Outcome
              </label>
              <div className={`grid ${isNoviceUaaphil ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'} gap-3`}>
                <button
                  type="button"
                  onClick={() => setSelectedWinnerCorner('RED')}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    selectedWinnerCorner === 'RED'
                      ? 'bg-rose-950/80 border-rose-500 ring-2 ring-rose-500/50 shadow-lg'
                      : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-black uppercase tracking-wider text-rose-400">RED CORNER</span>
                  <p className="font-bold text-slate-100 text-sm mt-1 break-words line-clamp-2">{redAthleteName}</p>
                  <p className="text-xs text-slate-400 mt-1">Rounds: {redRoundsWon} ({totalRedScore} pts)</p>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedWinnerCorner('BLUE')}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    selectedWinnerCorner === 'BLUE'
                      ? 'bg-blue-950/80 border-blue-500 ring-2 ring-blue-500/50 shadow-lg'
                      : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-black uppercase tracking-wider text-blue-400">BLUE CORNER</span>
                  <p className="font-bold text-slate-100 text-sm mt-1 break-words line-clamp-2">{blueAthleteName}</p>
                  <p className="text-xs text-slate-400 mt-1">Rounds: {blueRoundsWon} ({totalBlueScore} pts)</p>
                </button>

                {isNoviceUaaphil && (
                  <button
                    type="button"
                    onClick={() => setSelectedWinnerCorner('DRAW')}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      selectedWinnerCorner === 'DRAW'
                        ? 'bg-indigo-950/80 border-indigo-500 ring-2 ring-indigo-500/50 shadow-lg'
                        : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-400">DRAW</span>
                    <p className="font-bold text-slate-100 text-sm mt-1 break-words">Official Draw</p>
                    <p className="text-xs text-slate-400 mt-1">Novice Rule (1-1 Final)</p>
                  </button>
                )}
              </div>
            </div>

            {/* Decision Type Selection */}
            <div>
              <label className="block text-xs uppercase font-bold text-slate-400 mb-2">
                Method of Decision
              </label>
              <select
                value={selectedDecision}
                onChange={(e) => setSelectedDecision(e.target.value as DecisionType)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                <option value="POINTS">POINTS (Decision by Score / Rounds)</option>
                <option value="TKO">TKO (Technical Knockout)</option>
                <option value="DQ">DQ (Disqualification)</option>
                <option value="DEFAULT">DEFAULT (Opponent No-Show / Forfeit)</option>
                <option value="VOLUNTARY_DROP">VOLUNTARY_DROP (Retirement / Tap-Out)</option>
              </select>
            </div>

            {/* Warning Note */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/90 leading-relaxed">
              <strong>Database Immutability Invariant:</strong> Once confirmed, this match will be marked <code>COMPLETED</code>, the winner will automatically advance to the parent bracket node, and the court will be released for the next match.
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCompletion}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 min-h-[44px]"
              >
                {isSubmitting ? (
                  <>Finalizing Match...</>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Confirm & Finalize Match
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL ASSIGNMENT MODAL */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-100">Re-queue / Cancel Match Assignment</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will release the match back to the SCHEDULED pool and free Court {court.identifier}.
            </p>
            <input
              type="text"
              placeholder="Reason for cancellation (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-amber-400"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                disabled={isSubmitting}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleCancelAssignment}
                disabled={isSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Confirm Re-queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUBLIC SCOREBOARD MODAL */}
      <PublicScoreboardModal
        isOpen={showPublicScoreboard}
        match={match}
        court={court}
        currentRound={currentRound}
        roundScores={roundScores}
        isTimerRunning={isTimerRunning}
        timerSeconds={timerSeconds}
        onClose={() => setShowPublicScoreboard(false)}
      />
    </div>
  );
};
