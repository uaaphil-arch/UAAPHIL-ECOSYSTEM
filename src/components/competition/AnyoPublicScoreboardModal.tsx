import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X,
  Sparkles,
  Trophy,
  Award,
  Medal,
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Clock,
  ShieldAlert,
  Maximize2,
  Minimize2,
  User,
  ChevronRight,
  HelpCircle,
} from 'lucide-react';
import { AnyoCategorySession, AnyoPerformance, AnyoScore } from '../../types/tournament';
import { AnyoLiveSyncBadge } from './AnyoLiveSyncBadge';
import { useAnyoRealtimeSync } from '../../hooks/useAnyoRealtimeSync';

interface AnyoPublicScoreboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AnyoCategorySession;
  performances: AnyoPerformance[];
  scores: AnyoScore[];
  onRefresh?: () => void | Promise<void>;
}

export const AnyoPublicScoreboardModal: React.FC<AnyoPublicScoreboardModalProps> = ({
  isOpen,
  onClose,
  session,
  performances,
  scores,
  onRefresh,
}) => {
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);

  // Authoritative Realtime & Freshness tracking (P1-A, P1-B, P1-C, P1-D, P-ANYO-LIVE-05)
  const defaultRefresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
    }
  }, [onRefresh]);

  const { syncState, lastSyncTimestamp, isSyncing, syncNow } = useAnyoRealtimeSync({
    sessionId: session.id,
    onRefresh: defaultRefresh,
    staleThresholdSeconds: 30,
  });

  // Accessible Focus Management, Escape key listener & Kiosk toggle hotkey
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      modalContainerRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (isKioskMode) {
            setIsKioskMode(false);
          } else {
            onClose();
          }
        } else if ((e.key === 'f' || e.key === 'F') && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
          setIsKioskMode((prev) => !prev);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (triggerElementRef.current && typeof triggerElementRef.current.focus === 'function') {
          triggerElementRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose, isKioskMode]);

  // Derive Current Active Performance
  const activePerf = useMemo(() => {
    if (session.current_performance_id) {
      const match = performances.find((p) => p.id === session.current_performance_id);
      if (match) return match;
    }
    return (
      performances.find((p) => p.status === 'PERFORMING') ||
      performances.find((p) => p.status === 'CALLED') ||
      performances[0] ||
      null
    );
  }, [performances, session.current_performance_id]);

  // Derive Up Next Performance (Authoritative earliest WAITING or CALLED excluding active)
  const nextPerf = useMemo(() => {
    const queue = performances
      .filter((p) => (p.status === 'WAITING' || p.status === 'CALLED') && p.id !== activePerf?.id)
      .sort((a, b) => a.order_number - b.order_number);
    return queue[0] || null;
  }, [performances, activePerf]);

  const activeScore = useMemo(() => {
    if (!activePerf) return null;
    return scores.find((s) => s.performance_id === activePerf.id && s.tier === 'TIER_1') || null;
  }, [scores, activePerf]);

  const completedPerformances = useMemo(() => {
    return performances.filter((p) => p.status === 'COMPLETED');
  }, [performances]);

  const completedCount = completedPerformances.length;
  const isFinalized = session.status === 'FINALIZED';

  // Authoritative Ranked Performances Projection (Strictly uses server rank when finalized, or sorted score)
  const sortedPerformances = useMemo(() => {
    return [...performances].sort((a, b) => {
      if (isFinalized) {
        if (a.final_rank && b.final_rank) return a.final_rank - b.final_rank;
        if (a.final_rank) return -1;
        if (b.final_rank) return 1;
      }
      if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return -1;
      if (a.status !== 'COMPLETED' && b.status === 'COMPLETED') return 1;
      return (b.final_score || 0) - (a.final_score || 0);
    });
  }, [performances, isFinalized]);

  // Current Leader (Top ranked completed performance)
  const currentLeader = useMemo(() => {
    return sortedPerformances.find((p) => p.status === 'COMPLETED') || null;
  }, [sortedPerformances]);

  // Identify unresolved medal ties (Podium ranks 1–3)
  const medalTiedClusters: Array<{
    score: number;
    performances: AnyoPerformance[];
    startRank: number;
    endRank: number;
  }> = useMemo(() => {
    if (isFinalized) return [];
    let currentRankOffset = 1;
    const scoreGroupMap = new Map<number, AnyoPerformance[]>();
    for (const perf of sortedPerformances.filter((p) => p.status === 'COMPLETED')) {
      const s = Number(perf.final_score) || 0;
      const existing = scoreGroupMap.get(s) || [];
      existing.push(perf);
      scoreGroupMap.set(s, existing);
    }

    const clusters: Array<{
      score: number;
      performances: AnyoPerformance[];
      startRank: number;
      endRank: number;
    }> = [];

    scoreGroupMap.forEach((groupPerformances, score) => {
      const groupSize = groupPerformances.length;
      const startRank = currentRankOffset;
      const endRank = currentRankOffset + groupSize - 1;
      if (startRank <= 3 && groupSize > 1) {
        clusters.push({
          score,
          performances: groupPerformances,
          startRank,
          endRank,
        });
      }
      currentRankOffset += groupSize;
    });

    return clusters;
  }, [isFinalized, sortedPerformances]);

  const hasUnresolvedMedalTie = !isFinalized && medalTiedClusters.length > 0;

  // Deterministic Rank presentation calculation
  const getPerformanceRankInfo = (perf: AnyoPerformance) => {
    if (perf.status !== 'COMPLETED') {
      return { rank: null, isTied: false, displayRank: '—' };
    }

    if (perf.final_rank) {
      return {
        rank: perf.final_rank,
        isTied: false,
        displayRank: `${perf.final_rank}`,
      };
    }

    const higherScoreCount = sortedPerformances.filter(
      (p) => p.status === 'COMPLETED' && (p.final_score || 0) > (perf.final_score || 0)
    ).length;
    const computedRank = higherScoreCount + 1;

    const sameScoreCount = sortedPerformances.filter(
      (p) => p.status === 'COMPLETED' && p.final_score === perf.final_score
    ).length;
    const isTied = sameScoreCount > 1;

    return {
      rank: computedRank,
      isTied,
      displayRank: isTied ? `T-${computedRank}` : `${computedRank}`,
    };
  };

  if (!isOpen) return null;

  return (
    <div
      id="anyo-public-scoreboard-overlay"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-md ${
        isKioskMode ? 'p-0 sm:p-2 overflow-y-auto' : 'p-3 sm:p-6 overflow-y-auto'
      }`}
    >
      <div
        ref={modalContainerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Anyo Arena Public Scoreboard"
        className={`bg-slate-900 border border-slate-800 shadow-2xl transition-all duration-200 relative focus:outline-hidden ${
          isKioskMode
            ? 'w-full min-h-screen rounded-none sm:rounded-3xl p-6 sm:p-10 space-y-6'
            : 'max-w-5xl w-full rounded-3xl p-5 sm:p-8 space-y-6 my-auto'
        }`}
      >
        {/* Top Control Bar (Close & Kiosk Toggle) */}
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6 flex items-center gap-2 z-20">
          <button
            id="toggle-kiosk-mode-btn"
            onClick={() => setIsKioskMode((prev) => !prev)}
            aria-label={isKioskMode ? 'Exit Arena Kiosk Mode (Hotkey: F or Esc)' : 'Enter Arena Kiosk Mode (Hotkey: F)'}
            title={isKioskMode ? 'Exit Arena Kiosk Mode (F)' : 'Enter Arena Kiosk Mode (F)'}
            className="p-2.5 text-slate-400 hover:text-amber-300 bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 rounded-full transition-all min-h-[44px] min-w-[44px] flex items-center justify-center shadow-md focus:ring-2 focus:ring-amber-500/50"
          >
            {isKioskMode ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          <button
            id="close-scoreboard-btn"
            onClick={onClose}
            aria-label="Close Arena Scoreboard"
            className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 rounded-full transition-all min-h-[44px] min-w-[44px] flex items-center justify-center shadow-md focus:ring-2 focus:ring-slate-500/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Header & Realtime Freshness Status */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1 border-b border-slate-800 pb-4 pr-24 sm:pr-28">
          <div className="flex items-center gap-2.5 flex-wrap text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-widest">
              <Sparkles className="w-3.5 h-3.5" />
              UAAPHIL ANYO LIVE ARENA
            </div>
            <span className="text-xs sm:text-sm text-slate-300 font-bold px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 font-mono">
              {session.court?.name || (session.court?.identifier ? `Court ${session.court.identifier}` : 'Main Arena')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <AnyoLiveSyncBadge
              syncState={syncState}
              lastSyncTimestamp={lastSyncTimestamp}
              onManualSync={syncNow}
              isSyncing={isSyncing}
              arenaMode={isKioskMode}
            />
          </div>
        </div>

        {/* Tournament & Category Identity */}
        <div className="text-center space-y-1.5">
          <h1 className={`${isKioskMode ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-3xl'} font-black text-slate-100 tracking-tight`}>
            {session.event?.name || 'Anyo Performance Championship'}
          </h1>
          <div className="flex items-center justify-center gap-2 text-xs sm:text-sm text-slate-400 font-mono flex-wrap">
            <span className="text-slate-200 font-bold">{session.event?.category}</span>
            <span>•</span>
            <span className="text-slate-300">{session.event?.division}</span>
            <span>•</span>
            <span>Panel: {session.panel_size === '7_JUDGES' ? '7 Judges' : '5 Judges'} ({session.calc_method.replace('_', ' ')})</span>
          </div>
        </div>

        {/* Authoritative Category Status Banner (1-Second Glance Clarity) */}
        {isFinalized ? (
          <div
            id="scoreboard-final-status-banner"
            className="p-4 sm:p-5 bg-purple-950/70 border-2 border-purple-600 rounded-2xl text-center space-y-1 shadow-xl shadow-purple-950/50 ring-1 ring-purple-500/40"
          >
            <div className="flex items-center justify-center gap-2 text-purple-200 font-black text-base sm:text-lg uppercase tracking-wider">
              <Lock className="w-5 h-5 text-purple-400 shrink-0" />
              <span>OFFICIAL FINAL RESULTS · CATEGORY CLOSED</span>
            </div>
            <p className="text-xs sm:text-sm text-purple-200/90 font-medium max-w-2xl mx-auto">
              All performances locked. Gold, Silver, and Bronze medals have been authoritatively certified.
              {session.finalized_at && ` (Certified: ${new Date(session.finalized_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
            </p>
          </div>
        ) : hasUnresolvedMedalTie ? (
          <div
            id="scoreboard-tie-warning-banner"
            className="p-4 sm:p-5 bg-amber-950/80 border-2 border-amber-500 rounded-2xl text-center space-y-1 shadow-xl shadow-amber-950/50 ring-1 ring-amber-500/50"
          >
            <div className="flex items-center justify-center gap-2 text-amber-200 font-black text-base sm:text-lg uppercase tracking-wider">
              <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
              <span>PROVISIONAL STANDINGS · MEDAL POSITION UNRESOLVED</span>
            </div>
            <p className="text-xs sm:text-sm text-amber-200/90 font-medium max-w-3xl mx-auto">
              {medalTiedClusters.length} tied score cluster(s) affect podium positions (Ranks 1–3). Awaiting official Tier 2 Re-Performance or Tier 3 Majority Resolution. No medals are final.
            </p>
          </div>
        ) : (
          <div
            id="scoreboard-provisional-banner"
            className="p-3.5 sm:p-4 bg-blue-950/60 border border-blue-700/80 rounded-2xl text-center space-y-0.5 shadow-sm"
          >
            <div className="flex items-center justify-center gap-2 text-blue-200 font-bold text-xs sm:text-sm uppercase tracking-wider">
              <Clock className="w-4 h-4 text-blue-400 shrink-0" />
              <span>PROVISIONAL STANDINGS · SESSION IN PROGRESS</span>
            </div>
            <p className="text-xs text-blue-200/80">
              {completedCount} of {performances.length} routines completed. Standings remain strictly provisional until the category is authoritatively finalized.
            </p>
          </div>
        )}

        {/* Stale / Offline Warning Banner */}
        {(syncState === 'STALE' || syncState === 'OFFLINE' || syncState === 'RECOVERING') && (
          <div className="p-3.5 bg-rose-950/90 border border-rose-800 rounded-xl text-xs sm:text-sm text-rose-200 flex items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
              <span>
                {syncState === 'RECOVERING'
                  ? 'Connection restored — verifying authoritative results from tournament server…'
                  : syncState === 'OFFLINE'
                  ? 'Realtime connectivity lost. Displayed standings may not reflect live entries.'
                  : 'Data synchronization is stale. Standings may not reflect recent judge marks.'}
              </span>
            </div>
            <button
              onClick={syncNow}
              disabled={isSyncing}
              className="px-3.5 py-1.5 bg-rose-900 hover:bg-rose-800 text-white font-bold rounded-lg shrink-0 transition-colors flex items-center gap-1.5 text-xs shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Re-sync</span>
            </button>
          </div>
        )}

        {/* Athlete Context Spotlight Grid (Current Athlete + Up Next + Current Leader) */}
        <div className={`grid grid-cols-1 ${isKioskMode ? 'lg:grid-cols-12 gap-6' : 'md:grid-cols-12 gap-4'}`}>
          {/* Main Current Performer Spotlight */}
          <div className={`${isKioskMode ? 'lg:col-span-8' : 'md:col-span-8'} bg-linear-to-b from-slate-800/90 to-slate-950 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-xl text-center space-y-5 relative overflow-hidden`}>
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-black text-xs uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                {isFinalized
                  ? 'Featured Routine'
                  : activePerf?.status === 'PERFORMING'
                  ? 'Currently on Court'
                  : 'Active Routine'}
              </span>

              {activePerf && (
                <span className="text-xs font-mono font-bold text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
                  Routine #{activePerf.order_number} of {performances.length}
                </span>
              )}
            </div>

            {activePerf ? (
              <div className="space-y-4">
                <div>
                  <h2 className={`${isKioskMode ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-4xl'} font-black text-slate-100 tracking-tight`}>
                    {activePerf.registration?.user_profile?.full_name || 'Active Competitor'}
                  </h2>
                  <p className={`${isKioskMode ? 'text-base sm:text-xl' : 'text-sm sm:text-base'} font-bold text-amber-400/90 mt-1`}>
                    {activePerf.registration?.team_name || 'Independent Entry'}
                  </p>
                </div>

                {/* Score Output */}
                {activePerf.final_score ? (
                  <div className="inline-block bg-slate-950/90 border-2 border-amber-500/60 rounded-3xl px-8 sm:px-12 py-4 shadow-2xl">
                    <div className="text-[11px] sm:text-xs text-slate-400 uppercase font-mono tracking-widest font-bold">
                      {isFinalized ? 'Official Certified Score' : 'Calculated Score (Provisional)'}
                    </div>
                    <div className={`${isKioskMode ? 'text-5xl sm:text-7xl' : 'text-4xl sm:text-6xl'} font-black text-amber-400 font-mono mt-1`}>
                      {activePerf.final_score.toFixed(2)} <span className="text-xl sm:text-2xl text-slate-400 font-sans">pts</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-3">
                    <span className="inline-flex items-center gap-2 text-sm sm:text-base font-black px-6 py-3 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-2xl animate-pulse uppercase tracking-wider">
                      <Sparkles className="w-4 h-4" />
                      {activePerf.status === 'PERFORMING' ? 'PERFORMING NOW ON COURT' : 'WAITING FOR JUDGE SCORES'}
                    </span>
                  </div>
                )}

                {/* Judge Mark Breakdown */}
                {activeScore && activeScore.judge_scores && (
                  <div className="pt-2">
                    <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2 font-mono">
                      Judge Marks ({session.calc_method.replace('_', ' ')})
                    </div>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {activeScore.judge_scores.map((sc, i) => (
                        <div
                          key={i}
                          className="px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm font-bold text-slate-200 shadow-sm"
                        >
                          <span className="text-slate-400 font-mono">J{i + 1}: </span>
                          <span className="text-amber-300 font-mono font-black">{sc.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-slate-500 text-sm italic font-medium">
                No active performance currently selected.
              </div>
            )}
          </div>

          {/* Up Next & Current Leader Side Panel */}
          <div className={`${isKioskMode ? 'lg:col-span-4' : 'md:col-span-4'} flex flex-col gap-4`}>
            {/* Up Next Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <ChevronRight className="w-4 h-4" />
                    Up Next on Court
                  </span>
                  {nextPerf && (
                    <span className="font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700">
                      #{nextPerf.order_number}
                    </span>
                  )}
                </div>

                {nextPerf ? (
                  <div className="space-y-1.5">
                    <div className="text-lg sm:text-xl font-black text-slate-100 leading-snug">
                      {nextPerf.registration?.user_profile?.full_name || 'Upcoming Competitor'}
                    </div>
                    <div className="text-xs text-slate-400 font-semibold">
                      {nextPerf.registration?.team_name || 'Independent Entry'}
                    </div>
                    <div className="pt-2">
                      <span className="inline-block text-[11px] font-bold px-2.5 py-1 bg-blue-950/60 text-blue-300 border border-blue-800 rounded-lg">
                        {nextPerf.status === 'CALLED' ? 'Called to Ready Area' : 'On Deck in Queue'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-slate-500 text-xs font-mono">
                    UP NEXT — INFORMATION NOT AVAILABLE
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
                Order determined by seeded marching draw.
              </div>
            </div>

            {/* Current Provisional Leader Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <Trophy className="w-4 h-4" />
                    {isFinalized ? 'Gold Medalist' : 'Current Leader (Provisional)'}
                  </span>
                </div>

                {currentLeader ? (
                  <div className="space-y-1.5">
                    <div className="text-lg sm:text-xl font-black text-slate-100 leading-snug flex items-center gap-2">
                      <span>{currentLeader.registration?.user_profile?.full_name || 'Leader'}</span>
                    </div>
                    <div className="text-xs text-slate-400 font-semibold">
                      {currentLeader.registration?.team_name || 'Independent Entry'}
                    </div>
                    <div className="text-sm font-black font-mono text-amber-400 pt-1">
                      {currentLeader.final_score?.toFixed(2)} pts
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-slate-500 text-xs font-mono">
                    Awaiting first completed routine
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                {isFinalized ? 'Official Champion' : 'Provisional — Subject to remaining routines'}
              </div>
            </div>
          </div>
        </div>

        {/* Live Leaderboard Standings Table */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs sm:text-sm font-black text-slate-300 uppercase tracking-wider flex items-center gap-2 font-mono">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>{isFinalized ? 'Official Category Standings' : 'Current Category Standings (Provisional)'}</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono font-bold bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              {completedCount} / {performances.length} Completed
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-inner">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm min-w-[550px]">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider font-mono">
                  <tr>
                    <th className="px-4 sm:px-6 py-3.5 text-center w-24">Rank</th>
                    <th className="px-4 sm:px-6 py-3.5">Competitor / Team</th>
                    <th className="px-4 sm:px-6 py-3.5 text-center w-28">Routine #</th>
                    <th className="px-4 sm:px-6 py-3.5 text-right w-32">Score</th>
                    <th className="px-4 sm:px-6 py-3.5 text-center w-32">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {sortedPerformances.map((perf) => {
                    const rankInfo = getPerformanceRankInfo(perf);
                    const isRowActive = activePerf?.id === perf.id;

                    return (
                      <tr
                        key={perf.id}
                        className={`transition-colors ${
                          isRowActive
                            ? 'bg-amber-500/10 hover:bg-amber-500/15'
                            : 'hover:bg-slate-900/60'
                        }`}
                      >
                        <td className="px-4 sm:px-6 py-3.5 text-center">
                          {/* Official Medals strictly when perf.medal_awarded is present */}
                          {perf.medal_awarded === 'GOLD' ? (
                            <span
                              className="w-8 h-8 rounded-full bg-amber-400 text-slate-950 font-black inline-flex items-center justify-center text-xs sm:text-sm shadow-md"
                              title="Official Gold Medalist"
                            >
                              1 🥇
                            </span>
                          ) : perf.medal_awarded === 'SILVER' ? (
                            <span
                              className="w-8 h-8 rounded-full bg-slate-300 text-slate-950 font-black inline-flex items-center justify-center text-xs sm:text-sm shadow-md"
                              title="Official Silver Medalist"
                            >
                              2 🥈
                            </span>
                          ) : perf.medal_awarded === 'BRONZE' ? (
                            <span
                              className="w-8 h-8 rounded-full bg-amber-700 text-white font-black inline-flex items-center justify-center text-xs sm:text-sm shadow-md"
                              title="Official Bronze Medalist"
                            >
                              3 🥉
                            </span>
                          ) : rankInfo.isTied ? (
                            <span
                              className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-black text-xs"
                              title="Tied Score (Provisional)"
                            >
                              {rankInfo.displayRank}
                            </span>
                          ) : rankInfo.rank === 1 ? (
                            <span
                              className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-black ${
                                isFinalized ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-amber-300 border border-amber-500/50'
                              }`}
                              title={isFinalized ? 'Rank 1' : 'Current Leader (Provisional)'}
                            >
                              1
                            </span>
                          ) : rankInfo.rank === 2 ? (
                            <span
                              className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-black ${
                                isFinalized ? 'bg-slate-300 text-slate-950' : 'bg-slate-800 text-slate-300 border border-slate-600'
                              }`}
                              title={isFinalized ? 'Rank 2' : 'Current 2nd (Provisional)'}
                            >
                              2
                            </span>
                          ) : rankInfo.rank === 3 ? (
                            <span
                              className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-black ${
                                isFinalized ? 'bg-amber-700 text-white' : 'bg-slate-800 text-amber-500 border border-amber-700/60'
                              }`}
                              title={isFinalized ? 'Rank 3' : 'Current 3rd (Provisional)'}
                            >
                              3
                            </span>
                          ) : (
                            <span className="font-mono text-slate-500 font-bold">{rankInfo.displayRank}</span>
                          )}
                        </td>
                        <td className="px-4 sm:px-6 py-3.5 font-semibold text-slate-200">
                          <div className="text-sm sm:text-base font-bold text-slate-100">
                            {perf.registration?.user_profile?.full_name || 'Competitor'}
                          </div>
                          <div className="text-xs text-slate-400 font-normal">
                            {perf.registration?.team_name || 'Independent Entry'}
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-3.5 text-center font-mono text-slate-400 font-bold">
                          #{perf.order_number}
                        </td>
                        <td className="px-4 sm:px-6 py-3.5 text-right font-mono font-black text-amber-400 text-sm sm:text-base">
                          {perf.final_score ? `${perf.final_score.toFixed(2)} pts` : '—'}
                        </td>
                        <td className="px-4 sm:px-6 py-3.5 text-center">
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full font-bold inline-block font-mono ${
                              perf.status === 'COMPLETED'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                                : perf.status === 'PERFORMING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                : perf.status === 'DQ' || perf.status === 'NO_SHOW'
                                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {perf.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer Notice for Public / Announcer Safety */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-xs text-slate-400 text-center font-mono">
            {isFinalized ? (
              <span className="text-emerald-400 font-medium">
                ✓ Certified Official Results. Published and verified by UAAPHIL Tournament Operations.
              </span>
            ) : (
              <span>
                <strong>Notice for Floor Announcers & Spectators:</strong> Standings and routine leads are strictly
                provisional until all competitors perform and the category is authoritatively finalized.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
