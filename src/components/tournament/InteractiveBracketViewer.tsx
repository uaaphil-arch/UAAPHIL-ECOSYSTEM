import React, { useState, useEffect, useMemo } from 'react';
import {
  Trophy,
  Filter,
  Search,
  Printer,
  RefreshCw,
  Info,
  ChevronRight,
  Shield,
  Activity,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Tournament, TournamentEvent, Match } from '../../types/tournament';
import { EventBracket, BracketRound, BracketSummary } from '../../types/brackets';
import { bracketService } from '../../services/bracketService';
import { tournamentService } from '../../services/tournamentService';
import { BracketMatchNode } from './BracketMatchNode';
import { BracketPrintView } from './BracketPrintView';

interface InteractiveBracketViewerProps {
  tournament: Tournament;
  canManage?: boolean;
  onOpenCourtOperations?: (matchId: string) => void;
  onRefresh?: () => void;
}

export const InteractiveBracketViewer: React.FC<InteractiveBracketViewerProps> = ({
  tournament,
  canManage,
  onOpenCourtOperations,
  onRefresh,
}) => {
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<string>('ALL');

  // Print View Modal
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  // Seeding Placement View toggle
  const [showSeedingModal, setShowSeedingModal] = useState<boolean>(false);

  // Load Events & Matches
  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [eventsData, matchesData] = await Promise.all([
        tournamentService.getEventsByTournamentId(tournament.id),
        bracketService.getTournamentBracketMatches(tournament.id),
      ]);

      setEvents(eventsData);
      setMatches(matchesData);

      // Auto-select first sparring event if available
      if (!selectedEventId && eventsData.length > 0) {
        const firstSparring = eventsData.find((e) => {
          const catStr = typeof e.category === 'string' ? e.category : (e.category as any)?.name || '';
          return !e.name?.toLowerCase().includes('anyo') && !catStr.toLowerCase().includes('anyo');
        });
        setSelectedEventId(firstSparring ? firstSparring.id : eventsData[0].id);
      }
    } catch (err: any) {
      console.error('Error loading bracket data:', err);
      setError(err.message || 'Failed to load tournament brackets');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to realtime match changes
    const unsubscribe = bracketService.subscribeToMatches(tournament.id, () => {
      loadData();
      if (onRefresh) onRefresh();
    });

    return () => {
      unsubscribe();
    };
  }, [tournament.id]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const gender = e.gender || (e as any).gender_category;
      if (genderFilter !== 'ALL' && gender !== genderFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = e.name?.toLowerCase().includes(q);
        const divStr = typeof e.division === 'string' ? e.division : (e.division as any)?.name || '';
        const catStr = typeof e.category === 'string' ? e.category : (e.category as any)?.name || '';
        return matchesName || divStr.toLowerCase().includes(q) || catStr.toLowerCase().includes(q);
      }
      return true;
    });
  }, [events, genderFilter, searchQuery]);

  // Selected Event Object
  const selectedEvent = useMemo(() => {
    return events.find((e) => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  // Structured Event Bracket
  const currentBracket: EventBracket | null = useMemo(() => {
    if (!selectedEvent) return null;
    return bracketService.buildEventBracket(selectedEvent, matches);
  }, [selectedEvent, matches]);

  // Overall Tournament Bracket Summary
  const summary: BracketSummary = useMemo(() => {
    const eventSet = new Set<string>();
    let completedCount = 0;
    let liveCount = 0;
    let scheduledCount = 0;
    let byesCount = 0;

    matches.forEach((m) => {
      if (m.event_id) eventSet.add(m.event_id);
      if (m.court_identifier === 'BYE') byesCount++;
      else if (m.status === 'COMPLETED') completedCount++;
      else if (m.status === 'IN_PROGRESS') liveCount++;
      else if (m.status === 'SCHEDULED') scheduledCount++;
    });

    return {
      tournament_id: tournament.id,
      total_events: eventSet.size,
      total_bracket_nodes: matches.length,
      total_byes: byesCount,
      completed_matches: completedCount,
      live_matches: liveCount,
      scheduled_matches: scheduledCount,
      has_active_or_completed_matches: liveCount > 0 || completedCount > 0,
    };
  }, [matches, tournament.id]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Summary Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
              <Trophy className="w-4 h-4" />
              Interactive Tournament Bracket Explorer
            </div>
            <h2 className="text-2xl font-black text-slate-100">{tournament.name}</h2>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
              <span>{tournament.venue || 'Main Competition Arena'}</span>
              <span>•</span>
              <span>Status: <strong className="text-slate-200">{tournament.status}</strong></span>
              <span>•</span>
              <span>Total Bracket Nodes: <strong className="text-amber-400">{summary.total_bracket_nodes}</strong></span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {currentBracket && !currentBracket.is_anyo && currentBracket.rounds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowSeedingModal(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-sky-400" />
                  Seed Allocations
                </button>

                <button
                  type="button"
                  onClick={() => setShowPrintModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold shadow-lg shadow-amber-400/10 transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Bracket Sheet
                </button>
              </>
            )}
          </div>
        </div>

        {/* Global Metric Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-slate-500">Total Matches</div>
            <div className="text-lg font-black text-slate-200 mt-0.5">{summary.total_bracket_nodes}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-emerald-500">Completed</div>
            <div className="text-lg font-black text-emerald-400 mt-0.5">{summary.completed_matches}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-amber-500">In Progress / Live</div>
            <div className="text-lg font-black text-amber-400 mt-0.5">{summary.live_matches}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-slate-400">Byes Advanced</div>
            <div className="text-lg font-black text-slate-400 mt-0.5">{summary.total_byes}</div>
          </div>
        </div>
      </div>

      {/* Event Selection & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
          {/* Event Dropdown */}
          <div className="flex-1 max-w-xl">
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Select Competition Event / Bracket
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-400 font-semibold"
            >
              {filteredEvents.map((evt) => {
                const catStr = typeof evt.category === 'string' ? evt.category : (evt.category as any)?.name || '';
                const divStr = typeof evt.division === 'string' ? evt.division : (evt.division as any)?.name || evt.division_id || '';
                const gender = evt.gender || (evt as any).gender_category || 'Open';
                const isAnyo = evt.name?.toLowerCase().includes('anyo') || catStr.toLowerCase().includes('anyo');
                const eventMatchCount = matches.filter((m) => m.event_id === evt.id).length;
                return (
                  <option key={evt.id} value={evt.id}>
                    {evt.name} ({gender} • {divStr} {isAnyo ? '• Anyo Form' : `• Sparring • ${eventMatchCount} matches`})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 self-end">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
              {(['ALL', 'MALE', 'FEMALE'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenderFilter(g)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    genderFilter === g
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g === 'ALL' ? 'All Genders' : g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Visual Bracket Canvas */}
      {isLoading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-16 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-amber-400" />
          <p className="text-sm font-semibold">Loading tournament bracket topology...</p>
        </div>
      ) : !selectedEvent ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-16 text-center text-slate-400">
          <Info className="w-8 h-8 mx-auto text-slate-500 mb-2" />
          <p className="text-sm font-semibold">No competition event selected.</p>
        </div>
      ) : currentBracket?.is_anyo ? (
        /* Anyo / Form Event Informational View */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center max-w-2xl mx-auto space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-400">
            <Sparkles className="w-7 h-7" />
          </div>
          <h3 className="text-xl font-bold text-slate-100">Anyo / Form Performance Event</h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
            This event is governed by the <strong>UAAPHIL Anyo Performance Scoring Engine (O-34)</strong>. It utilizes scheduled athlete performance sessions and Olympic-trimmed judge scorecards rather than single-elimination sparring elimination trees.
          </p>
          <div className="pt-2">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-amber-400 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              Manage via Court Control &gt; Anyo Engine
            </div>
          </div>
        </div>
      ) : currentBracket && currentBracket.rounds.length === 0 ? (
        /* Empty Sparring Bracket View */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-16 text-center max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-200">No Bracket Generated Yet</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Matches for this sparring event have not been generated yet. When the tournament is locked and snapshotted, authorized officials can generate the official single-elimination tournament tree.
          </p>
        </div>
      ) : (
        /* Full Single-Elimination Tree Viewer */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          {/* Bracket Subheader */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="text-xs font-black text-amber-400 uppercase tracking-wider">
                {selectedEvent.name}
              </div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {currentBracket?.rounds.length} Competition Rounds • {currentBracket?.total_matches} Bracket Nodes
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Completed: {currentBracket?.completed_matches}
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Live: {currentBracket?.live_matches}
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Byes: {currentBracket?.byes_count}
              </span>
            </div>
          </div>

          {/* Horizontally Scrollable Tree Grid */}
          <div className="overflow-x-auto pb-6 pt-2">
            <div className="flex items-stretch gap-10 min-w-max px-2">
              {currentBracket?.rounds.map((round, roundIdx) => (
                <div key={round.round_number} className="w-72 flex flex-col">
                  {/* Round Column Header */}
                  <div className="sticky top-0 z-10 text-center py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-2xl mb-6 shadow-md">
                    <div className="text-xs font-black uppercase tracking-wider text-amber-400">
                      {round.round_name}
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium">
                      {round.nodes.length} {round.nodes.length === 1 ? 'Match' : 'Matches'}
                    </div>
                  </div>

                  {/* Round Matches Stack */}
                  <div className="flex-1 flex flex-col justify-around gap-6 py-2">
                    {round.nodes.map((node) => (
                      <div key={node.match_id} className="flex items-center">
                        <BracketMatchNode
                          node={node}
                          canManage={canManage}
                          onOpenCourtOperations={onOpenCourtOperations}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Print View Modal */}
      {showPrintModal && currentBracket && (
        <BracketPrintView
          tournament={tournament}
          bracket={currentBracket}
          events={filteredEvents}
          onSelectEvent={(id) => setSelectedEventId(id)}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* Seeding & Placement Allocation Modal */}
      {showSeedingModal && currentBracket && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-100 font-bold text-lg">
                <Shield className="w-5 h-5 text-sky-400" />
                Database-Generated Seed &amp; Placement Overview
              </div>
              <button
                type="button"
                onClick={() => setShowSeedingModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-400 leading-relaxed space-y-2">
              <p>
                In accordance with UAAPHIL single-elimination tournament rules, participants are distributed through authoritative recursive binary doubling tree slots to ensure balanced distribution of top seeds and deterministic BYE resolution.
              </p>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300">
                Event: {selectedEvent?.name} ({selectedEvent?.gender || (selectedEvent as any)?.gender_category || 'Open'} • {selectedEvent?.weight_class || (selectedEvent as any)?.weight_category || 'Standard'})
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {currentBracket.rounds[0]?.nodes.map((n) => (
                <div
                  key={n.match_id}
                  className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-amber-400 mr-2">Match #{n.match_number}</span>
                    <span className="text-slate-300">{n.red_participant.athlete_name}</span>
                    <span className="text-slate-500 mx-2">vs</span>
                    <span className="text-slate-300">{n.blue_participant.athlete_name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">
                    {n.is_bye_node ? (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">BYE Advanced</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">Slot #{n.bracket_node_index}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSeedingModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
