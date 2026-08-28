import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  Award,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  ChevronRight,
  Sparkles,
  Loader2,
  UserX,
  Vote,
  Trophy,
  Info,
  Dices,
  ListOrdered,
  Medal,
  History,
  Play,
} from 'lucide-react';
import {
  AnyoCategorySession,
  AnyoPerformance,
  AnyoScore,
  AnyoTieTier,
} from '../../types/tournament';
import { anyoScoringService } from '../../services/anyoScoringService';
import { useAuth } from '../../context/AuthContext';
import { AnyoLiveSyncBadge } from './AnyoLiveSyncBadge';
import { useAnyoRealtimeSync } from '../../hooks/useAnyoRealtimeSync';
import { AnyoActivePerformerWorkspace } from './anyo/AnyoActivePerformerWorkspace';
import { AnyoStagedPerformerWorkspace } from './anyo/AnyoStagedPerformerWorkspace';
import { AnyoCompletedPerformerWorkspace } from './anyo/AnyoCompletedPerformerWorkspace';
import { AnyoTerminalStatusWorkspace } from './anyo/AnyoTerminalStatusWorkspace';

interface AnyoScoringConsoleProps {
  session: AnyoCategorySession;
  performances: AnyoPerformance[];
  scores: AnyoScore[];
  isReadOnly?: boolean;
  isOperationsReadOnly?: boolean;
  onRefresh: () => void;
  onOpenScoreboard: () => void;
}

export const AnyoScoringConsole: React.FC<AnyoScoringConsoleProps> = ({
  session,
  performances,
  scores,
  isReadOnly = false,
  isOperationsReadOnly,
  onRefresh,
  onOpenScoreboard,
}) => {
  const { user } = useAuth();
  const panelCount = session.panel_size === '7_JUDGES' ? 7 : 5;

  // Phase 03: Authoritative Current (PERFORMING) and Next (Earliest WAITING/CALLED) Resolution
  const performingPerformance = useMemo(() => {
    return performances.find((p) => p.status === 'PERFORMING') || null;
  }, [performances]);

  const nextEligiblePerformance = useMemo(() => {
    return (
      [...performances]
        .filter((p) => p.status === 'WAITING' || p.status === 'CHECKED_IN' || p.status === 'CALLED')
        .sort((a, b) => a.order_number - b.order_number)[0] || null
    );
  }, [performances]);

  // Selected Performer state (defaults to actively PERFORMING, or earliest eligible next, or first performance)
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<string | null>(() => {
    if (session.current_performance_id) {
      const match = performances.find((p) => p.id === session.current_performance_id);
      if (match) return match.id;
    }
    const performing = performances.find((p) => p.status === 'PERFORMING');
    if (performing) return performing.id;
    const nextEligible = [...performances]
      .filter((p) => p.status === 'WAITING' || p.status === 'CHECKED_IN' || p.status === 'CALLED')
      .sort((a, b) => a.order_number - b.order_number)[0];
    return nextEligible?.id || (performances.length > 0 ? performances[0].id : null);
  });

  // Active / Inspected Performer
  const activePerformance = useMemo(() => {
    return performances.find((p) => p.id === selectedPerformanceId) || performances[0] || null;
  }, [performances, selectedPerformanceId]);

  // Existing score for active performer
  const activeScore = useMemo(() => {
    if (!activePerformance) return null;
    return scores.find((s) => s.performance_id === activePerformance.id && s.tier === 'TIER_1') || null;
  }, [scores, activePerformance]);

  const activeTier2Score = useMemo(() => {
    if (!activePerformance) return null;
    return scores.find((s) => s.performance_id === activePerformance.id && s.tier === 'TIER_2') || null;
  }, [scores, activePerformance]);

  // Phase 02 & Phase 03 Client-Side State Gates
  const isPerforming = activePerformance?.status === 'PERFORMING';
  const canScore = Boolean(
    activePerformance &&
      isPerforming &&
      session.status !== 'FINALIZED' &&
      !isReadOnly
  );

  // Physical Check-In / Marshalling State Registry (persisted per session)
  const [checkedInIds, setCheckedInIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`anyo_checked_in_${session.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load anyo checked in IDs from storage:', e);
    }
    return [];
  });

  // Auto-sync performers that are already CALLED, PERFORMING, or COMPLETED as inherently checked-in
  useEffect(() => {
    const activeOrCompletedIds = performances
      .filter((p) => p.status === 'CALLED' || p.status === 'PERFORMING' || p.status === 'COMPLETED')
      .map((p) => p.id);

    if (activeOrCompletedIds.length > 0) {
      setCheckedInIds((prev) => {
        const combined = Array.from(new Set([...prev, ...activeOrCompletedIds]));
        if (combined.length !== prev.length) {
          try {
            localStorage.setItem(`anyo_checked_in_${session.id}`, JSON.stringify(combined));
          } catch (e) {
            console.warn('Failed to persist checked-in IDs:', e);
          }
          return combined;
        }
        return prev;
      });
    }
  }, [performances, session.id]);

  const isPerformanceCheckedIn = (perfId: string): boolean => {
    const perf = performances.find((p) => p.id === perfId);
    return !!perf && ['CHECKED_IN', 'CALLED', 'PERFORMING', 'COMPLETED'].includes(perf.status);
  };

  const operationsReadOnly = isOperationsReadOnly ?? isReadOnly;

  const handleCheckIn = async (perfId: string) => {
    if (operationsReadOnly) {
      setErrorMessage('Unauthorized: Check-in actions are restricted to authorized tournament officials.');
      return;
    }
    
    try {
      await anyoScoringService.markPerformerCheckedIn(perfId);
      setSuccessMessage('Competitor physically checked in successfully.');
      onRefresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to check in competitor.');
    }
  };

  const isActiveCheckedIn = activePerformance ? isPerformanceCheckedIn(activePerformance.id) : false;

  const [isCallingPerformer, setIsCallingPerformer] = useState(false);

  // Can call this specific active performance? (Must be CHECKED_IN, no other performer is PERFORMING, and must be the next eligible in sequence)
  const isNextEligible = activePerformance?.id === nextEligiblePerformance?.id;
  const hasActivePerformer = Boolean(performingPerformance && performingPerformance.id !== activePerformance?.id);
  const canCallActive = Boolean(
    activePerformance &&
      activePerformance.status === 'CHECKED_IN' &&
      isActiveCheckedIn &&
      !hasActivePerformer &&
      isNextEligible &&
      session.status !== 'FINALIZED' &&
      !operationsReadOnly &&
      !isCallingPerformer
  );

  // In-progress inputs map (keyed by `${perfId}_${tier}`) to prevent data loss on realtime refreshes (INV-ANYO-UI-03 / F-ANYO-01)
  const [inProgressInputs, setInProgressInputs] = useState<Record<string, number[]>>({});

  // Judge scores state (Array of length 5 or 7, initial 0 = unselected)
  const [judgeInputs, setJudgeInputs] = useState<number[]>(Array(panelCount).fill(0));
  const [activeTier, setActiveTier] = useState<AnyoTieTier>('TIER_1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal states
  const [showTier3Modal, setShowTier3Modal] = useState(false);
  const [tier3Tallies, setTier3Tallies] = useState<Record<string, number>>({});
  const [tier3WinnerId, setTier3WinnerId] = useState<string>('');
  const [selectedClusterIndex, setSelectedClusterIndex] = useState<number>(0);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Marching Order Preview Modal
  const [showDrawModal, setShowDrawModal] = useState(false);

  // Sync inputs when active performer or tier changes, prioritizing dirty in-progress inputs
  useEffect(() => {
    if (activePerformance) {
      const currentKey = `${activePerformance.id}_${activeTier}`;
      if (inProgressInputs[currentKey]) {
        setJudgeInputs([...inProgressInputs[currentKey]]);
      } else {
        const currentScoreRecord = activeTier === 'TIER_2' ? activeTier2Score : activeScore;
        if (currentScoreRecord && currentScoreRecord.judge_scores?.length === panelCount) {
          setJudgeInputs([...currentScoreRecord.judge_scores]);
        } else {
          setJudgeInputs(Array(panelCount).fill(0));
        }
      }
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [activePerformance?.id, activeTier, activeScore?.id, activeTier2Score?.id, panelCount]);

  // Authoritative Realtime & Freshness tracking (P1-A, P1-B, P1-C, P1-D)
  const defaultRefresh = React.useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
    }
  }, [onRefresh]);

  const { syncState, lastSyncTimestamp, isSyncing: isRefreshingState, syncNow } = useAnyoRealtimeSync({
    sessionId: session.id,
    onRefresh: defaultRefresh,
    staleThresholdSeconds: 30,
  });

  // Decimal score scale (7.0 to 10.0 in 0.1 increments = 31 valid values)
  const SCORE_GROUPS = useMemo(() => {
    const group7 = Array.from({ length: 10 }, (_, i) => Number((7 + i * 0.1).toFixed(1)));
    const group8 = Array.from({ length: 10 }, (_, i) => Number((8 + i * 0.1).toFixed(1)));
    const group9 = Array.from({ length: 10 }, (_, i) => Number((9 + i * 0.1).toFixed(1)));
    const group10 = [10.0];
    return [
      { label: '7.x Range', scores: group7 },
      { label: '8.x Range', scores: group8 },
      { label: '9.x Range', scores: group9 },
      { label: '10.0 Range', scores: group10 },
    ];
  }, []);

  const allJudgesEntered = useMemo(() => {
    return (
      judgeInputs.length === panelCount &&
      judgeInputs.every(
        (val) =>
          typeof val === 'number' &&
          val >= 7.0 &&
          val <= 10.0 &&
          Number.isFinite(val) &&
          Math.round(val * 10) === val * 10
      )
    );
  }, [judgeInputs, panelCount]);

  // Informational Preview of Score Calculation (Authoritative calculation remains server-side)
  const scorePreview = useMemo(() => {
    if (!allJudgesEntered) return null;
    const sorted = [...judgeInputs].sort((a, b) => a - b);
    if (session.calc_method === 'OLYMPIC_TRIM') {
      const trimmed = sorted.slice(1, sorted.length - 1);
      const sum = trimmed.reduce((acc, v) => acc + v, 0);
      const avg = sum / trimmed.length;
      return {
        sorted,
        minTrimmed: sorted[0],
        maxTrimmed: sorted[sorted.length - 1],
        trimmedScores: trimmed,
        score: Number(avg.toFixed(2)),
      };
    } else {
      const sum = judgeInputs.reduce((acc, v) => acc + v, 0);
      const avg = sum / judgeInputs.length;
      return {
        sorted,
        minTrimmed: null,
        maxTrimmed: null,
        trimmedScores: judgeInputs,
        score: Number(avg.toFixed(2)),
      };
    }
  }, [judgeInputs, allJudgesEntered, session.calc_method]);

  const handleScoreSelect = (judgeIndex: number, scoreValue: number) => {
    if (!canScore || isReadOnly || !activePerformance) return;
    if (scoreValue < 7.0 || scoreValue > 10.0 || Math.round(scoreValue * 10) !== scoreValue * 10) {
      return;
    }
    const currentKey = `${activePerformance.id}_${activeTier}`;
    const next = [...judgeInputs];
    next[judgeIndex] = scoreValue;
    setJudgeInputs(next);
    setInProgressInputs((prev) => ({
      ...prev,
      [currentKey]: next,
    }));
    setErrorMessage(null);
  };

  const handleSubmitScores = async () => {
    if (!activePerformance || !canScore || isReadOnly) return;
    if (!allJudgesEntered) {
      setErrorMessage(`Please select valid decimal scores (7.0 – 10.0) for all ${panelCount} judges.`);
      return;
    }

    if (syncState === 'STALE' || syncState === 'OFFLINE') {
      const proceed = window.confirm(
        'WARNING: Realtime connection is currently STALE or OFFLINE.\n\nIt is strongly advised to Re-sync before recording official marks.\n\nDo you want to proceed with submission anyway?'
      );
      if (!proceed) return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await anyoScoringService.recordAnyoScore(
        activePerformance.id,
        judgeInputs,
        activeTier
      );
      const currentKey = `${activePerformance.id}_${activeTier}`;
      setInProgressInputs((prev) => {
        const next = { ...prev };
        delete next[currentKey];
        return next;
      });
      setSuccessMessage(`Authoritative score recorded: ${res.calculated_score.toFixed(2)} pts.`);
      onRefresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to record Anyo score.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCallPerformer = async (perfId: string) => {
    if (isCallingPerformer || operationsReadOnly) return;
    setIsCallingPerformer(true);
    setErrorMessage(null);
    try {
      await anyoScoringService.callPerformer(perfId);
      setSelectedPerformanceId(perfId);
      setSuccessMessage('Athlete successfully called to court.');
      onRefresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to call competitor.');
    } finally {
      setIsCallingPerformer(false);
    }
  };

  const handleDqOrNoShow = async (outcome: 'DQ' | 'NO_SHOW') => {
    if (!activePerformance) return;

    if (activePerformance.status === 'DQ' || activePerformance.status === 'NO_SHOW') {
      setErrorMessage(`Competitor is already in immutable terminal status (${activePerformance.status}).`);
      return;
    }

    if (activePerformance.status === 'COMPLETED') {
      const reason = window.prompt(
        `[RETROACTIVE ADJUDICATION]\n\nThis competitor has already COMPLETED their performance.\nTo retroactively mark them as ${outcome}, enter a mandatory official reason:`
      );
      if (reason === null) return; // User cancelled prompt
      if (!reason.trim()) {
        setErrorMessage('Retroactive adjudication requires a non-empty reason.');
        return;
      }

      try {
        await anyoScoringService.recordDqOrNoShow(activePerformance.id, outcome, reason.trim(), true);
        setSuccessMessage(`Retroactively marked competitor as ${outcome}.`);
        onRefresh();
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : `Failed to record retroactive ${outcome}.`);
      }
      return;
    }

    const conf = window.confirm(`Are you sure you want to mark this competitor as ${outcome}?`);
    if (!conf) return;

    try {
      await anyoScoringService.recordDqOrNoShow(activePerformance.id, outcome);
      setSuccessMessage(`Marked competitor as ${outcome}.`);
      onRefresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : `Failed to record ${outcome}.`);
    }
  };

  const handleNextCompetitor = () => {
    if (nextEligiblePerformance) {
      setSelectedPerformanceId(nextEligiblePerformance.id);
      setActiveTier('TIER_1');
    } else if (activePerformance) {
      const currentIndex = performances.findIndex((p) => p.id === activePerformance.id);
      if (currentIndex >= 0 && currentIndex < performances.length - 1) {
        const nextPerf = performances[currentIndex + 1];
        setSelectedPerformanceId(nextPerf.id);
        setActiveTier('TIER_1');
      }
    }
  };

  const handleFinalizeCategory = async () => {
    if (operationsReadOnly) return;
    setIsFinalizing(true);
    setErrorMessage(null);
    try {
      const res = await anyoScoringService.finalizeCategory(session.id);
      setShowFinalizeModal(false);
      setSuccessMessage(`Category finalized! Ranked ${res.ranked_count} competitors.`);
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to finalize category.';
      if (msg.toLowerCase().includes('tie') || msg.toLowerCase().includes('medal')) {
        setErrorMessage(`CANNOT FINALIZE: Unresolved medal contention detected. Please perform Tier 2 Re-Performance or submit a Tier 3 Majority Vote before finalizing.`);
      } else {
        setErrorMessage(`CANNOT FINALIZE: ${msg}`);
      }
    } finally {
      setIsFinalizing(false);
    }
  };

  // Identify completed performances and group into distinct score clusters
  const completedPerformances = performances.filter((p) => p.status === 'COMPLETED');
  const sortedCompletedPerformances = [...completedPerformances].sort((a, b) => (b.final_score || 0) - (a.final_score || 0));

  // Find distinct tied clusters intersecting medal positions (startRank <= 3)
  const medalTiedClusters: Array<{
    score: number;
    performances: AnyoPerformance[];
    startRank: number;
    endRank: number;
  }> = [];

  let currentRankOffset = 1;
  const scoreGroupMap = new Map<number, AnyoPerformance[]>();
  for (const perf of sortedCompletedPerformances) {
    const s = Number(perf.final_score) || 0;
    const existing = scoreGroupMap.get(s) || [];
    existing.push(perf);
    scoreGroupMap.set(s, existing);
  }

  scoreGroupMap.forEach((groupPerformances, score) => {
    const groupSize = groupPerformances.length;
    const startRank = currentRankOffset;
    const endRank = currentRankOffset + groupSize - 1;
    if (startRank <= 3 && groupSize > 1) {
      medalTiedClusters.push({
        score,
        performances: groupPerformances,
        startRank,
        endRank,
      });
    }
    currentRankOffset += groupSize;
  });

  const activeTiedCluster = medalTiedClusters[selectedClusterIndex] || medalTiedClusters[0] || null;
  const activeClusterPerformances = activeTiedCluster ? activeTiedCluster.performances : [];

  const handleSubmitTier3 = async () => {
    if (operationsReadOnly) return;
    if (!tier3WinnerId) {
      setErrorMessage('Please select the winning competitor for Tier 3 majority vote.');
      return;
    }

    if (!activeClusterPerformances || activeClusterPerformances.length < 2) {
      setErrorMessage('No valid tied competitors found in the selected cluster.');
      return;
    }

    // Build tallies payload scoped strictly to the active cluster
    const clusterTallies: Record<string, number> = {};
    for (const perf of activeClusterPerformances) {
      const voteVal = Number(tier3Tallies[perf.id]) || 0;
      if (voteVal < 0) {
        setErrorMessage(`Vote count for ${perf.registration?.user_profile?.full_name || perf.id} cannot be negative.`);
        return;
      }
      clusterTallies[perf.id] = voteVal;
    }

    const totalVotes = Object.values(clusterTallies).reduce<number>((acc, v) => acc + v, 0);
    if (totalVotes !== panelCount) {
      setErrorMessage(`Total votes entered (${totalVotes}) must equal the panel size (${panelCount}).`);
      return;
    }

    const minMajority = Math.floor(panelCount / 2) + 1;
    const winnerVotes = clusterTallies[tier3WinnerId] || 0;
    if (winnerVotes < minMajority) {
      setErrorMessage(
        `Winning competitor received ${winnerVotes} votes, failing to obtain a strict majority of at least ${minMajority} votes for a ${panelCount}-judge panel.`
      );
      return;
    }

    for (const perf of activeClusterPerformances) {
      if (perf.id !== tier3WinnerId && (clusterTallies[perf.id] || 0) >= winnerVotes) {
        setErrorMessage('The designated winner must have strictly more votes than all other tied competitors.');
        return;
      }
    }

    try {
      await anyoScoringService.recordTier3Majority(
        session.id,
        activeClusterPerformances.map((p) => p.id),
        clusterTallies,
        tier3WinnerId
      );
      setShowTier3Modal(false);
      setSuccessMessage(`Tier 3 majority tally recorded for score cluster ${activeTiedCluster?.score.toFixed(2)} pts.`);
      onRefresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to record Tier 3 vote.');
    }
  };

  const completedCount = performances.filter(
    (p) => p.status === 'COMPLETED' || p.status === 'DQ' || p.status === 'NO_SHOW'
  ).length;

  // Flatten all medal tied performances for UI badges
  const medalTiedPerformances = medalTiedClusters.flatMap((c) => c.performances);

  // Derive whether the active performer is an unresolved medal-contending tie participant (P-ANYO-UI-TIER-SEMANTICS-01)
  const isTiedMedalContender = useMemo(() => {
    if (!activePerformance || medalTiedPerformances.length === 0) return false;
    return medalTiedPerformances.some((p) => p.id === activePerformance.id);
  }, [activePerformance, medalTiedPerformances]);

  // Ensure activeTier strictly defaults/resets to TIER_1 whenever active competitor is not a tied medal contender
  useEffect(() => {
    if (!isTiedMedalContender && activeTier !== 'TIER_1') {
      setActiveTier('TIER_1');
    }
  }, [isTiedMedalContender, activeTier]);

  const renderSeedBadge = (perf: AnyoPerformance) => {
    const tier = perf.seed_tier || 5;

    if (tier === 1) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <Award className="w-3 h-3 text-amber-400" />
          Top Seed (Gold)
        </span>
      );
    }
    if (tier === 2) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-300/20 text-slate-200 border border-slate-400/40">
          <Medal className="w-3 h-3 text-slate-300" />
          High Seed (Silver)
        </span>
      );
    }
    if (tier === 3) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-700/20 text-amber-400 border border-amber-700/40">
          <Medal className="w-3 h-3 text-amber-500" />
          Seeded (Bronze)
        </span>
      );
    }
    if (tier === 4) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
          Experienced
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
        Unseeded
      </span>
    );
  };

  const drawStatus = session.draw_status || 'PENDING';
  const drawVersion = session.draw_version || 0;

  return (
    <div className="space-y-6">
      {/* Operator Context Lock Breadcrumb Bar (P-ANYO-LIVE-05 Phase 7) */}
      <div className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs font-mono text-slate-400 gap-3 shadow-inner flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-slate-300">
          <span className="font-bold text-amber-400 uppercase tracking-wide">OPERATOR CONTEXT:</span>
          <span>{session.event?.name || 'Tournament'}</span>
          <span className="text-slate-600">→</span>
          <span className="text-slate-200 font-semibold">{session.event?.category}</span>
          <span className="text-slate-600">→</span>
          <span className="text-slate-200 font-semibold">{session.event?.division}</span>
          <span className="text-slate-600">→</span>
          <span className="text-amber-300 font-semibold">{session.court?.name || (session.court?.identifier ? `Court ${session.court.identifier}` : 'Main Arena')}</span>
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          Session ID: <span className="text-slate-400">#{session.id.substring(0, 8)}</span>
        </div>
      </div>

      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                ANYO FORM ENGINE
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {panelCount} JUDGES ({session.calc_method.replace('_', ' ')})
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  session.status === 'FINALIZED'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                    : 'bg-blue-950 text-blue-300 border border-blue-800'
                }`}
              >
                {session.status === 'FINALIZED' ? 'OFFICIAL FINAL' : 'PROVISIONAL'}
              </span>

              {/* Seeded Marching Order Status Badge */}
              {drawStatus === 'CONFIRMED' ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Official Marching Order Locked (v{drawVersion})
                </span>
              ) : drawStatus === 'GENERATED' ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                  <Dices className="w-3 h-3" />
                  Draft Draw v{drawVersion} (Review Pending)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                  <ListOrdered className="w-3 h-3" />
                  Draw Pending
                </span>
              )}
            </div>

            <h2 className="text-xl font-bold text-slate-100 mt-1.5 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              {session.event?.name || 'Anyo Performance Session'}
            </h2>
            <p className="text-xs text-slate-400">
              {session.event?.category} • {session.event?.division} • Progress: {completedCount} / {performances.length} Completed
            </p>
          </div>

          {/* Action Buttons & Realtime Sync Status (P1-A, P1-B) */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <AnyoLiveSyncBadge
              syncState={syncState}
              lastSyncTimestamp={lastSyncTimestamp}
              onManualSync={syncNow}
              isSyncing={isRefreshingState}
              compact
            />

            {/* Marching Order Preview (Read-Only for Table Officials, Manageable in Competition Preparation) */}
            <button
              onClick={() => setShowDrawModal(true)}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border border-amber-500/30"
            >
              <ListOrdered className="w-4 h-4 text-amber-400" />
              <span>{drawStatus === 'CONFIRMED' ? 'View Official Draw' : 'Marching Order Status'}</span>
            </button>

            <button
              onClick={onOpenScoreboard}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-700"
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              Public Scoreboard
            </button>

            {session.status !== 'FINALIZED' && medalTiedPerformances.length > 0 && (
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setShowTier3Modal(true);
                }}
                disabled={isReadOnly}
                className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-amber-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border border-amber-500/40 animate-pulse"
              >
                <Vote className="w-4 h-4" />
                <span>Majority Vote Tie Resolution</span>
              </button>
            )}

            {session.status !== 'FINALIZED' && (
              <button
                onClick={() => setShowFinalizeModal(true)}
                disabled={isReadOnly || completedCount < performances.length || performances.length === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-purple-950/50"
              >
                <Lock className="w-4 h-4" />
                Finalize Category
              </button>
            )}
          </div>
        </div>

        {/* P1-E & P1-G & P1-H: Authoritative Category Status Banner */}
        {session.status === 'FINALIZED' ? (
          <div className="p-3 bg-purple-950/70 border border-purple-800 rounded-xl text-xs text-purple-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold">
              <Lock className="w-4 h-4 text-purple-400 shrink-0" />
              <span>
                <strong>OFFICIAL FINAL RESULTS:</strong> Category is locked and certified. Gold, Silver, and Bronze medals have been awarded.
              </span>
            </div>
            {session.finalized_at && (
              <span className="text-[11px] font-mono text-purple-300">
                Certified: {new Date(session.finalized_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        ) : (syncState === 'STALE' || syncState === 'OFFLINE') ? (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>{syncState === 'OFFLINE' ? 'Realtime Disconnected' : 'Stale Connection'}:</strong> Displayed standings may not reflect recent judge inputs. Click Re-sync to refresh.
              </span>
            </div>
            <button
              onClick={syncNow}
              disabled={isRefreshingState}
              className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white font-bold rounded-lg shrink-0 transition-colors"
            >
              Re-sync Now
            </button>
          </div>
        ) : null}

        {/* Medal Tie Notice Banner (P1-G) */}
        {session.status !== 'FINALIZED' && medalTiedPerformances.length > 0 && (
          <div className="p-3.5 bg-amber-950/70 border border-amber-600 rounded-xl text-amber-200 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>PROVISIONAL — MEDAL CONTENDING TIE DETECTED:</strong> {medalTiedPerformances.length} competitors share identical scores affecting podium ranks. Perform a Tier 2 Re-Performance or submit a Tier 3 Majority Vote before finalizing.
              </span>
            </div>
            <button
              onClick={() => setShowTier3Modal(true)}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shrink-0 transition-colors"
            >
              Resolve Tie
            </button>
          </div>
        )}

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 bg-emerald-950/60 border border-emerald-800 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* Main Scoring Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Performance Order Queue */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Performance Order
            </h3>
            <span className="text-xs text-slate-500">Click to inspect/score</span>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {performances.map((perf) => {
              const isSelected = activePerformance?.id === perf.id;
              const hasScore = perf.final_score !== null && perf.final_score !== undefined;

              return (
                <div
                  key={perf.id}
                  onClick={() => setSelectedPerformanceId(perf.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800 border-amber-500/60 ring-1 ring-amber-500/50 shadow-md'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                          perf.medal_awarded === 'GOLD'
                            ? 'bg-amber-400 text-slate-950'
                            : perf.medal_awarded === 'SILVER'
                            ? 'bg-slate-300 text-slate-950'
                            : perf.medal_awarded === 'BRONZE'
                            ? 'bg-amber-700 text-white'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        #{perf.order_number}
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-100 line-clamp-1">
                          {perf.registration?.user_profile?.full_name || 'Competitor'}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-slate-400">
                            {perf.registration?.team_name || 'Independent'}
                          </span>
                          {renderSeedBadge(perf)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {hasScore ? (
                        <div className="text-sm font-bold font-mono text-amber-400">
                          {perf.final_score?.toFixed(2)} pts
                        </div>
                      ) : (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            perf.status === 'PERFORMING'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                              : perf.status === 'CALLED'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : perf.status === 'DQ' || perf.status === 'NO_SHOW'
                              ? 'bg-red-950 text-red-400 border border-red-800'
                              : isPerformanceCheckedIn(perf.id)
                              ? perf.id === nextEligiblePerformance?.id && !performingPerformance
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                              : 'bg-amber-950/40 text-amber-400/90 border border-amber-800/40'
                          }`}
                        >
                          {perf.status === 'PERFORMING'
                            ? 'PERFORMING'
                            : perf.status === 'CALLED'
                            ? 'CALLED'
                            : perf.status === 'DQ'
                            ? 'DQ'
                            : perf.status === 'NO_SHOW'
                            ? 'NO SHOW'
                            : isPerformanceCheckedIn(perf.id)
                            ? perf.id === nextEligiblePerformance?.id && !performingPerformance
                              ? 'READY • NEXT'
                              : 'CHECKED IN • READY'
                            : 'NOT CHECKED IN'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Active Performer Touch-Friendly Scoring Console */}
        <div className="lg:col-span-8 space-y-4">
          {activePerformance ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              {/* Performer Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-amber-400 font-semibold tracking-wider uppercase flex items-center gap-2 flex-wrap">
                    <span>Performance #{activePerformance.order_number}</span>
                    <span>•</span>
                    <span
                      className={
                        activePerformance.status === 'PERFORMING'
                          ? 'text-amber-400 font-bold'
                          : activePerformance.status === 'CALLED'
                          ? 'text-blue-400 font-bold'
                          : activePerformance.status === 'COMPLETED'
                          ? 'text-emerald-400 font-bold'
                          : activePerformance.status === 'DQ' || activePerformance.status === 'NO_SHOW'
                          ? 'text-red-400 font-bold'
                          : isActiveCheckedIn
                          ? 'text-emerald-400 font-bold'
                          : 'text-amber-400/90 font-medium'
                      }
                    >
                      {activePerformance.status === 'PERFORMING'
                        ? 'PERFORMING'
                        : activePerformance.status === 'CALLED'
                        ? 'ATHLETE CALLED TO COURT'
                        : activePerformance.status === 'COMPLETED'
                        ? 'COMPLETED'
                        : activePerformance.status === 'DQ'
                        ? 'DISQUALIFIED (DQ)'
                        : activePerformance.status === 'NO_SHOW'
                        ? 'NO SHOW'
                        : isActiveCheckedIn
                        ? 'CHECKED IN • READY'
                        : 'NOT CHECKED IN • AWAITING MARSHALLING'}
                    </span>
                    <span>•</span>
                    {renderSeedBadge(activePerformance)}
                  </div>
                  <h3 className="text-2xl font-black text-slate-100 tracking-tight mt-0.5">
                    {activePerformance.registration?.user_profile?.full_name || 'Unknown Athlete'}
                  </h3>
                  <div className="text-xs text-slate-400">
                    Team: <span className="text-slate-200 font-medium">{activePerformance.registration?.team_name || 'Independent'}</span>
                  </div>
                </div>

                {/* Status & Tier Switcher */}
                <div className="flex items-center gap-2">
                  {isTiedMedalContender ? (
                    <div className="flex bg-slate-950 border border-amber-500/50 rounded-xl p-1 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setActiveTier('TIER_1')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                          activeTier === 'TIER_1'
                            ? 'bg-slate-800 text-slate-200 shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Standard Initial Scoring
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTier('TIER_2')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                          activeTier === 'TIER_2'
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'text-amber-400 hover:text-amber-300'
                        }`}
                      >
                        <Trophy className="w-3.5 h-3.5" />
                        <span>Tie-Break Re-Performance</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>Standard Initial Scoring</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Tier 2 Exception Notice */}
              {isTiedMedalContender && activeTier === 'TIER_2' && (
                <div className="bg-amber-950/40 border border-amber-600/50 rounded-xl p-3.5 flex items-start gap-3">
                  <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-amber-200 flex items-center gap-2">
                      <span>MEDAL TIE — TIE-BREAK RE-PERFORMANCE REQUIRED (EXCEPTION ONLY)</span>
                    </div>
                    <div className="text-amber-300/90">
                      Exception-only re-performance for legitimate medal-contending ties. {activePerformance.registration?.user_profile?.full_name} is tied at {activePerformance.final_score?.toFixed(2)} pts.
                    </div>
                  </div>
                </div>
              )}

              {/* Historical Seeding Basis Card (If available) */}
              {activePerformance.seed_tier && activePerformance.seed_tier < 5 && (
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 flex items-start gap-3">
                  <History className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <span>Historical Seeding Tier {activePerformance.seed_tier}: {activePerformance.historical_classification?.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-slate-400">
                      Calculated from official UAAPHIL 24-month Anyo category records (Cutoff: {activePerformance.seeding_cutoff_at ? new Date(activePerformance.seeding_cutoff_at).toLocaleDateString() : 'Snapshot'}). Grouped into later performance bracket.
                    </div>
                  </div>
                </div>
              )}

              {/* Read-Only Oversight Banner */}
              {isReadOnly && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>
                    <strong>Official Oversight Mode (Read-Only):</strong> Score recording, status changes, and administrative actions are locked for your current role.
                  </span>
                </div>
              )}

              {/* Inspection Notice if viewing off-court competitor while someone else is performing */}
              {hasActivePerformer && (
                <div className="p-3.5 bg-purple-950/50 border border-purple-800 rounded-xl text-xs text-purple-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>
                      You are inspecting <strong>#{activePerformance.order_number} ({activePerformance.registration?.user_profile?.full_name})</strong>. Performer <strong>#{performingPerformance?.order_number} ({performingPerformance?.registration?.user_profile?.full_name})</strong> is currently on court.
                    </span>
                  </div>
                  {performingPerformance && (
                    <button
                      type="button"
                      onClick={() => setSelectedPerformanceId(performingPerformance.id)}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-xs shrink-0 transition-colors"
                    >
                      Switch to Court Active (#{performingPerformance.order_number})
                    </button>
                  )}
                </div>
              )}

              {/* State-Dependent Workspace Dispatch (INV-ANYO-UI-04) */}
              {activePerformance.status === 'PERFORMING' ? (
                <AnyoActivePerformerWorkspace
                  panelCount={panelCount}
                  judgeInputs={judgeInputs}
                  scoreGroups={SCORE_GROUPS}
                  scorePreview={scorePreview}
                  allJudgesEntered={allJudgesEntered}
                  isSubmitting={isSubmitting}
                  isReadOnly={isReadOnly}
                  activeTier={activeTier}
                  calcMethod={session.calc_method}
                  onScoreSelect={handleScoreSelect}
                  onSubmitScores={handleSubmitScores}
                  onDqOrNoShow={handleDqOrNoShow}
                  onNextCompetitor={handleNextCompetitor}
                />
              ) : activePerformance.status === 'COMPLETED' ? (
                <AnyoCompletedPerformerWorkspace
                  performance={activePerformance}
                  score={activeScore}
                  tier2Score={activeTier2Score}
                  calcMethod={session.calc_method}
                  panelCount={panelCount}
                  isReadOnly={isReadOnly}
                  isFinalized={session.status === 'FINALIZED'}
                  onDqOrNoShow={handleDqOrNoShow}
                  onNextCompetitor={handleNextCompetitor}
                />
              ) : activePerformance.status === 'DQ' || activePerformance.status === 'NO_SHOW' ? (
                <AnyoTerminalStatusWorkspace
                  performance={activePerformance}
                  onNextCompetitor={handleNextCompetitor}
                />
              ) : (
                <AnyoStagedPerformerWorkspace
                  performance={activePerformance}
                  nextEligiblePerformance={nextEligiblePerformance}
                  performingPerformance={performingPerformance}
                  isCheckedIn={isActiveCheckedIn}
                  canCall={canCallActive}
                  isCalling={isCallingPerformer}
                  isReadOnly={operationsReadOnly}
                  panelCount={panelCount}
                  scoreGroups={SCORE_GROUPS}
                  onToggleCheckIn={handleCheckIn}
                  onCallPerformer={handleCallPerformer}
                  onDqOrNoShow={handleDqOrNoShow}
                  onNextCompetitor={handleNextCompetitor}
                />
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
              No performers enrolled in this Anyo session.
            </div>
          )}
        </div>
      </div>

      {/* Tier 3 Majority Vote Modal */}
      {showTier3Modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-amber-400">
              <Vote className="w-6 h-6" />
              <div>
                <h3 className="text-lg font-bold text-slate-100">Majority Vote Tie Resolution</h3>
                <div className="text-xs text-amber-400 font-mono">
                  {panelCount}-Judge Panel — Strict Majority Threshold: {Math.floor(panelCount / 2) + 1} votes
                </div>
              </div>
            </div>

            {/* Cluster Selector if multiple tied clusters exist */}
            {medalTiedClusters.length > 1 && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">Select Tied Score Cluster to Resolve:</label>
                <div className="flex gap-2 flex-wrap">
                  {medalTiedClusters.map((cluster, idx) => (
                    <button
                      key={cluster.score}
                      type="button"
                      onClick={() => {
                        setSelectedClusterIndex(idx);
                        setTier3WinnerId('');
                        setTier3Tallies({});
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedClusterIndex === idx
                          ? 'bg-amber-500 text-slate-950 shadow'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {cluster.score.toFixed(2)} pts (Ranks {cluster.startRank}–{cluster.endRank})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400">
              Judges indicate the winning competitor for the tied score of{' '}
              <strong className="text-amber-300">{activeTiedCluster?.score.toFixed(2) || '0.00'} pts</strong>.
              Enter total votes allocated to each competitor.
            </p>

            <div className="space-y-3">
              {activeClusterPerformances.map((perf) => (
                <div key={perf.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-slate-200">
                      {perf.registration?.user_profile?.full_name} (#{perf.order_number})
                    </span>
                    <div className="text-[11px] text-amber-400 font-mono font-bold">
                      Tier 1 Score: {perf.final_score?.toFixed(2)} pts
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Votes:</span>
                    <input
                      type="number"
                      min={0}
                      max={panelCount}
                      placeholder="0"
                      value={tier3Tallies[perf.id] ?? ''}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setTier3Tallies((prev) => ({ ...prev, [perf.id]: val }));
                      }}
                      className="w-20 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-center font-bold text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Vote Sum and Majority Status Indicator */}
            {(() => {
              const currentTotal = activeClusterPerformances.reduce<number>(
                (acc, p) => acc + (Number(tier3Tallies[p.id]) || 0),
                0
              );
              const isMatch = currentTotal === panelCount;
              const minMajority = Math.floor(panelCount / 2) + 1;
              const winnerVotes = tier3Tallies[tier3WinnerId] || 0;
              const hasMajority = winnerVotes >= minMajority;
              const hasWinner = Boolean(tier3WinnerId);

              // Check if all votes are entered but no single competitor has strict majority
              const maxVoteCount = Math.max(0, ...activeClusterPerformances.map((p) => Number(tier3Tallies[p.id]) || 0));
              const isInconclusive = isMatch && maxVoteCount < minMajority;

              return (
                <div className="space-y-2">
                  <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between font-mono ${
                    isMatch 
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' 
                      : 'bg-amber-950/40 border-amber-800 text-amber-300'
                  }`}>
                    <span>Total Allocated Votes:</span>
                    <span className="font-bold font-mono text-sm">{currentTotal} / {panelCount} {isMatch ? '✓' : '(Must Match)'}</span>
                  </div>

                  {isInconclusive && (
                    <div className="p-3 rounded-xl border border-rose-600 bg-rose-950/70 text-rose-200 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
                      <div>
                        <div className="font-black uppercase tracking-wider">INCONCLUSIVE BALLOT — NO WINNER</div>
                        <div className="text-[11px] text-rose-300">
                          Vote distribution does not produce a strict majority of at least {minMajority} votes. Re-ballot is required.
                        </div>
                      </div>
                    </div>
                  )}

                  {hasWinner && (
                    <div className={`p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between ${
                      hasMajority
                        ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                        : 'bg-rose-950/40 border-rose-800 text-rose-300'
                    }`}>
                      <span>Designated Winner Vote:</span>
                      <span className="font-bold">{winnerVotes} / {minMajority} required {hasMajority ? '✓ (Strict Majority)' : '✗ (Insufficient Majority)'}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-semibold">Select Official Majority Winner</label>
              <select
                value={tier3WinnerId}
                onChange={(e) => setTier3WinnerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs"
              >
                <option value="">-- Choose Majority Winner --</option>
                {activeClusterPerformances.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.registration?.user_profile?.full_name} (#{p.order_number}) — {p.final_score?.toFixed(2)} pts
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTier3Modal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitTier3}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-colors"
              >
                Confirm Majority Vote Resolution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Finalize Modal */}
      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-purple-400">
              <Lock className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-100">Finalize Anyo Category</h3>
            </div>
            <p className="text-xs text-slate-300">
              This will lock the category results, award Gold, Silver, and Bronze medals, and publish the official ranking. This action is immutable.
            </p>

            {medalTiedPerformances.length > 0 && (
              <div className="p-3 bg-amber-950/70 border border-amber-600 rounded-xl text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">UNRESOLVED MEDAL TIE WARNING:</strong> {medalTiedPerformances.length} competitors share tied scores impacting podium positions. Resolve via Tier 2 or Tier 3 before finalization to avoid rejection.
                </div>
              </div>
            )}

            <div className="p-3 bg-purple-950/30 border border-purple-800/60 rounded-xl text-xs text-purple-200 space-y-1">
              <div>• All {performances.length} competitors will be locked.</div>
              <div>• Medal standings and official certificates will become eligible.</div>
            </div>

            {isFinalizing && (
              <div className="p-3 bg-blue-950/80 border border-blue-700 rounded-xl text-xs text-blue-200 flex items-center gap-2 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                <span>CERTIFICATION IN PROGRESS — Waiting for authoritative server confirmation…</span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowFinalizeModal(false)}
                disabled={isFinalizing}
                className="px-4 py-2 bg-slate-800 disabled:opacity-50 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFinalizeCategory}
                disabled={isFinalizing}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-purple-950/50"
              >
                {isFinalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                <span>{isFinalizing ? 'Finalizing...' : 'Yes, Finalize Official Results'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seeded Marching Order Modal */}
      {showDrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-6 my-8">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    SEEDED MARCHING ORDER
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    Draw v{drawVersion || 1}
                  </span>
                  {drawStatus === 'CONFIRMED' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      LOCKED
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800">
                      DRAFT REVIEW
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-slate-100 mt-1">
                  {session.event?.name || 'Anyo Performance Session'}
                </h3>
                <p className="text-xs text-slate-400">
                  {session.event?.category} • {session.event?.division} • {performances.length} Competitors Enrolled
                </p>
              </div>

              {/* Seeding Policy Pill */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Snapshot Seeding Cutoff
                </div>
                <div className="text-xs font-bold font-mono text-amber-400 mt-0.5">
                  24-Month Platform History
                </div>
              </div>
            </div>

            {/* Tier Distribution Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center">
                <div className="text-[10px] uppercase tracking-wider font-bold text-amber-400">🥇 Tier 1 Gold</div>
                <div className="text-xl font-black text-amber-300 mt-1">
                  {performances.filter((p) => p.seed_tier === 1).length}
                </div>
              </div>
              <div className="p-3 bg-slate-400/10 border border-slate-400/30 rounded-xl text-center">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-300">🥈 Tier 2 Silver</div>
                <div className="text-xl font-black text-slate-200 mt-1">
                  {performances.filter((p) => p.seed_tier === 2).length}
                </div>
              </div>
              <div className="p-3 bg-amber-700/10 border border-amber-700/30 rounded-xl text-center">
                <div className="text-[10px] uppercase tracking-wider font-bold text-amber-500">🥉 Tier 3 Bronze</div>
                <div className="text-xl font-black text-amber-400 mt-1">
                  {performances.filter((p) => p.seed_tier === 3).length}
                </div>
              </div>
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-center">
                <div className="text-[10px] uppercase tracking-wider font-bold text-blue-400">🥋 Experienced</div>
                <div className="text-xl font-black text-blue-300 mt-1">
                  {performances.filter((p) => p.seed_tier === 4).length}
                </div>
              </div>
              <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-xl text-center col-span-2 sm:col-span-1">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">⚪ Unseeded</div>
                <div className="text-xl font-black text-slate-300 mt-1">
                  {performances.filter((p) => !p.seed_tier || p.seed_tier === 5).length}
                </div>
              </div>
            </div>

            {/* Invariant Explainer */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-start gap-3">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-slate-100">UAAPHIL Marching Order Rule:</strong> Competitors perform in ascending order (1 through {performances.length}). Higher seeded athletes (Tier 1 & 2) perform later in the session. Ties within seed tiers are randomized server-side.
              </p>
            </div>

            {/* Performance Order Table */}
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Sequential Marching Order
              </div>
              <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                {performances.map((perf) => (
                  <div
                    key={perf.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-slate-900/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-amber-400">
                        #{perf.order_number}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-100">
                          {perf.registration?.user_profile?.full_name || 'Competitor'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {perf.registration?.team_name || 'Independent'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {renderSeedBadge(perf)}
                      <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                        {perf.draw_group || 'GROUP'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-4 border-t border-slate-800 gap-3">
              <button
                type="button"
                onClick={() => setShowDrawModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
              >
                Close Preview
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {drawStatus !== 'CONFIRMED' ? (
                  <div className="text-xs text-amber-400 font-medium px-3 py-1 bg-amber-950/40 border border-amber-800/40 rounded-xl">
                    Official draw not yet confirmed. Marching order must be confirmed in Tournament Management.
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold px-3 py-1 bg-emerald-950/40 border border-emerald-800/40 rounded-xl">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Official Marching Order — Locked</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
