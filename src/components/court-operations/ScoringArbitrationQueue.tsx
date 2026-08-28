import React, { useState, useMemo } from 'react';
import {
  Award,
  Tv,
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
  Info
} from 'lucide-react';
import { 
  CourtTelemetry, 
  EnrichedQueueMatch, 
  ParticipantSummary 
} from '../../types/courtOperations';

export type ArbitrationFilter = 'ALL' | 'LIVE' | 'ATTENTION' | 'READY' | 'COMPLETED';

export type ArbitrationPriorityGroup = 'ATTENTION' | 'LIVE' | 'READY' | 'COMPLETED' | 'WAITING';

export interface ScoringArbitrationItem {
  id: string; // matchId
  matchId: string;
  assignmentId?: string;
  matchNumber: number;
  courtId?: string;
  courtName?: string;
  courtIdentifier?: string;
  eventId: string;
  eventName: string;
  division?: string;
  roundName: string;
  roundNumber: number;
  redAthlete: ParticipantSummary | null;
  blueAthlete: ParticipantSummary | null;
  authoritativeStatus: string;
  priorityGroup: ArbitrationPriorityGroup;
  operationalAttentionReason?: string;
  currentRound?: number;
  winnerRegistrationId?: string | null;
  isLive: boolean;
}

interface ScoringArbitrationQueueProps {
  telemetry: CourtTelemetry[];
  queue: EnrichedQueueMatch[];
  canScore: boolean;
  onOpenScoringConsole: (matchId: string, assignmentId: string) => void;
  onRefresh?: () => void;
}

export const ScoringArbitrationQueue: React.FC<ScoringArbitrationQueueProps> = ({
  telemetry,
  queue,
  canScore,
  onOpenScoringConsole,
  onRefresh,
}) => {
  const [activeFilter, setActiveFilter] = useState<ArbitrationFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventFilter, setEventFilter] = useState<string>('ALL');

  // Derive unique event names for the filter dropdown
  const uniqueEvents = useMemo(() => {
    const set = new Map<string, string>();
    queue.forEach((q) => {
      if (q.eventId && q.eventName) {
        set.set(q.eventId, q.eventName);
      }
    });
    telemetry.forEach((t) => {
      if (t.activeMatch?.eventId && t.activeMatch?.eventName) {
        set.set(t.activeMatch.eventId, t.activeMatch.eventName);
      }
    });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [queue, telemetry]);

  // Compile unified arbitration items from telemetry and queue
  const arbitrationItems: ScoringArbitrationItem[] = useMemo(() => {
    const itemsMap = new Map<string, ScoringArbitrationItem>();

    // 1. Process Live matches from Court Telemetry
    telemetry.forEach((court) => {
      if (court.activeMatch) {
        const m = court.activeMatch;
        const redScore = m.redAthlete?.score || 0;
        const blueScore = m.blueAthlete?.score || 0;
        const redAdv = m.redAthlete?.advantageCount || 0;
        const blueAdv = m.blueAthlete?.advantageCount || 0;

        let attentionReason: string | undefined;
        let priorityGroup: ArbitrationPriorityGroup = 'LIVE';

        // Check for operational attention scenarios
        if (!court.isActive) {
          attentionReason = 'Match assigned to court currently marked OFFLINE / PAUSED.';
          priorityGroup = 'ATTENTION';
        } else if (redScore > 0 && redScore === blueScore && redAdv === blueAdv) {
          attentionReason = `Live round score tie (${redScore} - ${blueScore}) — chief referee review / advantage determination pending.`;
          priorityGroup = 'ATTENTION';
        } else if (redScore === 0 && blueScore === 0) {
          attentionReason = 'Live bout in progress with zero recorded points — table official score entry in progress.';
          priorityGroup = 'ATTENTION';
        }

        itemsMap.set(m.matchId, {
          id: m.matchId,
          matchId: m.matchId,
          assignmentId: m.assignmentId,
          matchNumber: m.matchNumber,
          courtId: court.courtId,
          courtName: court.courtName,
          courtIdentifier: court.courtIdentifier,
          eventId: m.eventId,
          eventName: m.eventName,
          division: m.divisionName || m.weightCategory,
          roundName: m.roundName,
          roundNumber: m.roundNumber,
          redAthlete: m.redAthlete,
          blueAthlete: m.blueAthlete,
          authoritativeStatus: m.matchStatus || 'IN_PROGRESS',
          priorityGroup,
          operationalAttentionReason: attentionReason,
          currentRound: m.currentRound,
          isLive: true,
        });
      }
    });

    // 2. Process remaining matches from Enriched Queue
    queue.forEach((q) => {
      // If already processed via telemetry, skip duplicate
      if (itemsMap.has(q.matchId)) return;

      const matchingCourt = telemetry.find(
        (t) => t.courtId === q.assignedCourtId || t.courtIdentifier === q.assignedCourtIdentifier
      );

      let attentionReason: string | undefined;
      let priorityGroup: ArbitrationPriorityGroup = 'READY';
      const isLive = q.queueState === 'LIVE';

      if (q.queueState === 'COMPLETED') {
        priorityGroup = 'COMPLETED';
        if (!q.winnerRegistrationId) {
          attentionReason = 'Completed bout record without designated winner identifier.';
          priorityGroup = 'ATTENTION';
        }
      } else if (q.queueState === 'LIVE') {
        priorityGroup = 'LIVE';
        if (!q.assignmentId || !q.assignedCourtId) {
          attentionReason = 'Match state marked IN_PROGRESS but missing active court assignment record.';
          priorityGroup = 'ATTENTION';
        }
      } else if (q.queueState === 'READY' || q.queueState === 'ASSIGNED') {
        priorityGroup = 'READY';
        if (!q.redAthlete || !q.blueAthlete) {
          attentionReason = 'Ready queue bout with incomplete competitor registration.';
          priorityGroup = 'ATTENTION';
        }
      } else if (q.queueState === 'WAITING' || q.queueState === 'BLOCKED') {
        priorityGroup = 'WAITING';
      }

      itemsMap.set(q.matchId, {
        id: q.matchId,
        matchId: q.matchId,
        assignmentId: q.assignmentId,
        matchNumber: q.matchNumber,
        courtId: q.assignedCourtId || matchingCourt?.courtId,
        courtName: matchingCourt?.courtName,
        courtIdentifier: q.assignedCourtIdentifier || matchingCourt?.courtIdentifier,
        eventId: q.eventId,
        eventName: q.eventName,
        division: q.division,
        roundName: q.roundName,
        roundNumber: q.roundNumber,
        redAthlete: q.redAthlete,
        blueAthlete: q.blueAthlete,
        authoritativeStatus: q.queueState,
        priorityGroup,
        operationalAttentionReason: attentionReason,
        winnerRegistrationId: q.winnerRegistrationId,
        isLive,
      });
    });

    const allItems = Array.from(itemsMap.values());

    // Sort order: ATTENTION (1) -> LIVE (2) -> READY (3) -> COMPLETED (4) -> WAITING (5)
    const priorityWeight: Record<ArbitrationPriorityGroup, number> = {
      ATTENTION: 1,
      LIVE: 2,
      READY: 3,
      COMPLETED: 4,
      WAITING: 5,
    };

    return allItems.sort((a, b) => {
      const weightDiff = priorityWeight[a.priorityGroup] - priorityWeight[b.priorityGroup];
      if (weightDiff !== 0) return weightDiff;
      return a.matchNumber - b.matchNumber;
    });
  }, [telemetry, queue]);

  // Derive counts for summary KPI badges
  const counts = useMemo(() => {
    let live = 0;
    let attention = 0;
    let ready = 0;
    let completed = 0;

    arbitrationItems.forEach((item) => {
      if (item.isLive || item.priorityGroup === 'LIVE') live++;
      if (item.priorityGroup === 'ATTENTION' || item.operationalAttentionReason) attention++;
      if (item.priorityGroup === 'READY') ready++;
      if (item.priorityGroup === 'COMPLETED') completed++;
    });

    return { live, attention, ready, completed };
  }, [arbitrationItems]);

  // Apply active filters and search
  const filteredItems = useMemo(() => {
    return arbitrationItems.filter((item) => {
      // 1. Group / Status Filter
      if (activeFilter === 'LIVE') {
        if (!item.isLive && item.priorityGroup !== 'LIVE' && item.authoritativeStatus !== 'IN_PROGRESS') {
          return false;
        }
      } else if (activeFilter === 'ATTENTION') {
        if (!item.operationalAttentionReason && item.priorityGroup !== 'ATTENTION') {
          return false;
        }
      } else if (activeFilter === 'READY') {
        if (item.priorityGroup !== 'READY') return false;
      } else if (activeFilter === 'COMPLETED') {
        if (item.priorityGroup !== 'COMPLETED') return false;
      }

      // 2. Event Filter
      if (eventFilter !== 'ALL' && item.eventId !== eventFilter) {
        return false;
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNum = item.matchNumber.toString();
        const eventMatch = item.eventName?.toLowerCase().includes(q);
        const divMatch = item.division?.toLowerCase().includes(q);
        const courtMatch = item.courtName?.toLowerCase().includes(q) || item.courtIdentifier?.toLowerCase().includes(q);
        const redName = item.redAthlete?.athleteName?.toLowerCase().includes(q);
        const redTeam = item.redAthlete?.teamName?.toLowerCase().includes(q);
        const blueName = item.blueAthlete?.athleteName?.toLowerCase().includes(q);
        const blueTeam = item.blueAthlete?.teamName?.toLowerCase().includes(q);

        return (
          matchNum.includes(q) ||
          eventMatch ||
          divMatch ||
          courtMatch ||
          redName ||
          redTeam ||
          blueName ||
          blueTeam
        );
      }

      return true;
    });
  }, [arbitrationItems, activeFilter, eventFilter, searchQuery]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 1. Header Banner & Operational Scope */}
      <div className="p-3 sm:p-4 bg-linear-to-r from-red-500/10 via-red-500/5 to-transparent border border-red-300 dark:border-red-500/30 rounded-xl space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Scoring Supervision &amp; Arbitration Queue
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Real-time match telemetry audit, round verification, and chief referee arbitration desk.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors min-h-[32px] sm:min-h-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Sync Telemetry</span>
              </button>
            )}
            <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700 uppercase tracking-wider">
              CHIEF REFEREE DESK
            </span>
          </div>
        </div>
      </div>

      {/* 2. Compact Operational KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
        <button
          type="button"
          onClick={() => setActiveFilter('LIVE')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all min-h-[44px] ${
            activeFilter === 'LIVE'
              ? 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-red-500" />
              Live Now
            </span>
            <span className="text-[10px] sm:text-xs font-mono font-bold px-1.5 py-0.2 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
              {counts.live}
            </span>
          </div>
          <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
            {counts.live} <span className="text-[10px] sm:text-xs font-normal text-slate-500">Fighting</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('ATTENTION')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all min-h-[44px] ${
            activeFilter === 'ATTENTION'
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              Attention
            </span>
            <span className="text-[10px] sm:text-xs font-mono font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              {counts.attention}
            </span>
          </div>
          <div className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400 mt-1">
            {counts.attention} <span className="text-[10px] sm:text-xs font-normal text-slate-500">Review</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('READY')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all min-h-[44px] ${
            activeFilter === 'READY'
              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              Ready / On Deck
            </span>
            <span className="text-[10px] sm:text-xs font-mono font-bold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
              {counts.ready}
            </span>
          </div>
          <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
            {counts.ready} <span className="text-[10px] sm:text-xs font-normal text-slate-500">Scheduled</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveFilter('COMPLETED')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all min-h-[44px] ${
            activeFilter === 'COMPLETED'
              ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-300 dark:border-purple-800 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-purple-500" />
              Completed
            </span>
            <span className="text-[10px] sm:text-xs font-mono font-bold px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
              {counts.completed}
            </span>
          </div>
          <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
            {counts.completed} <span className="text-[10px] sm:text-xs font-normal text-slate-500">Concluded</span>
          </div>
        </button>
      </div>

      {/* 3. Control & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        {/* Priority Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'LIVE', 'ATTENTION', 'READY', 'COMPLETED'] as ArbitrationFilter[]).map((tab) => {
            const isSelected = activeFilter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-slate-900 dark:bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab === 'ALL' && 'All Bouts'}
                {tab === 'LIVE' && `Live (${counts.live})`}
                {tab === 'ATTENTION' && `Needs Attention (${counts.attention})`}
                {tab === 'READY' && `Ready (${counts.ready})`}
                {tab === 'COMPLETED' && `Completed (${counts.completed})`}
              </button>
            );
          })}
        </div>

        {/* Search & Event Dropdown */}
        <div className="flex items-center gap-2">
          {uniqueEvents.length > 1 && (
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="text-xs py-1.5 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-red-500"
            >
              <option value="ALL">All Events ({uniqueEvents.length})</option>
              {uniqueEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          )}

          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search bouts or athletes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs py-1.5 pl-8 pr-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-red-500"
            />
          </div>
        </div>
      </div>

      {/* 4. Arbitration Queue Item List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <Award className="w-8 h-8 mx-auto text-slate-400" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              No Matches Found
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              No bouts match the current filter selection ({activeFilter}). Match queue items will appear here as the tournament progresses.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredItems.map((item) => {
              const isAttention = item.priorityGroup === 'ATTENTION' || Boolean(item.operationalAttentionReason);
              const isLive = item.isLive || item.priorityGroup === 'LIVE';

              return (
                <div
                  key={item.id}
                  className={`p-4 bg-white dark:bg-slate-900 border rounded-xl transition-all space-y-3 ${
                    isAttention
                      ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/20 dark:bg-amber-950/10'
                      : isLive
                      ? 'border-red-300 dark:border-red-800/80 bg-red-50/15 dark:bg-red-950/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {/* Top Item Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Priority Tag */}
                      {isAttention ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          NEEDS ATTENTION
                        </span>
                      ) : isLive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700 animate-pulse">
                          <Flame className="w-3 h-3 text-red-600 dark:text-red-400" />
                          LIVE ROUND {item.currentRound || 1}
                        </span>
                      ) : item.priorityGroup === 'COMPLETED' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                          <CheckCircle2 className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                          COMPLETED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                          <Clock className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          READY / ON DECK
                        </span>
                      )}

                      {/* Ring / Court Location */}
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        {item.courtName ? (
                          <span>{item.courtName} {item.courtIdentifier ? `(${item.courtIdentifier})` : ''}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned Court</span>
                        )}
                      </span>

                      {/* Authoritative Database Status */}
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        DB: {item.authoritativeStatus}
                      </span>
                    </div>

                    {/* Match & Event Tag */}
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      <strong className="text-slate-800 dark:text-slate-200">Bout #{item.matchNumber}</strong> &bull; {item.eventName} ({item.roundName})
                    </div>
                  </div>

                  {/* Competitors & Scoring Display */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center">
                    {/* Red Corner */}
                    <div className="sm:col-span-5 p-2 sm:p-2.5 rounded-lg bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">
                          RED CORNER
                        </span>
                        {item.redAthlete?.score !== undefined && (
                          <span className="font-mono text-xs font-bold text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/60 px-1.5 py-0.2 rounded">
                            {item.redAthlete.score} pts
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                        {item.redAthlete?.athleteName || 'TBD / Pending Feeder'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.redAthlete?.teamName || 'Unassigned Club'}
                      </div>
                    </div>

                    {/* VS & Telemetry Center */}
                    <div className="sm:col-span-2 text-center py-0.5 sm:py-0">
                      <span className="text-xs font-black text-slate-400 dark:text-slate-500">VS</span>
                      {item.isLive && item.redAthlete?.score !== undefined && item.blueAthlete?.score !== undefined && (
                        <div className="font-mono font-black text-sm text-slate-900 dark:text-white mt-0.5">
                          {item.redAthlete.score} - {item.blueAthlete.score}
                        </div>
                      )}
                    </div>

                    {/* Blue Corner */}
                    <div className="sm:col-span-5 p-2 sm:p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                          BLUE CORNER
                        </span>
                        {item.blueAthlete?.score !== undefined && (
                          <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.2 rounded">
                            {item.blueAthlete.score} pts
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                        {item.blueAthlete?.athleteName || 'TBD / Pending Feeder'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.blueAthlete?.teamName || 'Unassigned Club'}
                      </div>
                    </div>
                  </div>

                  {/* Operational Attention Callout (Presentation-Only Derived) */}
                  {item.operationalAttentionReason && (
                    <div className="p-2 sm:p-2.5 rounded-lg bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold uppercase text-[10px] text-amber-800 dark:text-amber-300 block">
                          Operational Attention Indicator (Presentation-Only):
                        </span>
                        <span>{item.operationalAttentionReason}</span>
                      </div>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Division: <strong>{item.division || 'Open Category'}</strong>
                    </div>

                    <div>
                      {canScore && item.assignmentId ? (
                        <button
                          type="button"
                          onClick={() => onOpenScoringConsole(item.matchId, item.assignmentId!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg shadow-xs transition-colors min-h-[34px] sm:min-h-0"
                        >
                          <Tv className="w-3.5 h-3.5" />
                          Launch Scoring Console
                        </button>
                      ) : canScore && isLive ? (
                        <button
                          type="button"
                          onClick={() => onOpenScoringConsole(item.matchId, item.assignmentId || '')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg shadow-xs transition-colors min-h-[34px] sm:min-h-0"
                        >
                          <Tv className="w-3.5 h-3.5" />
                          Launch Scoring Console
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                          <Eye className="w-3 h-3 text-slate-400" />
                          Read-Only Telemetry
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
