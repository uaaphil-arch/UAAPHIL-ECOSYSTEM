import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Radio,
  Search,
  Maximize2,
  Minimize2,
  RefreshCw,
  Clock,
  CheckCircle2,
  Flame,
  Layers,
  Filter,
  Trophy,
  ExternalLink,
  Shield,
  Activity,
  Calendar,
  Zap,
  Users,
  ChevronRight,
  Tv,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Inbox,
} from 'lucide-react';
import {
  PublicScheduledMatch,
  PublicCourtOverview,
  PublicTournamentScheduleSummary,
  AthleteSearchResultItem,
  RealtimeSyncState,
} from '../../types/publicSchedule';
import { Tournament } from '../../types/tournament';
import { publicScheduleService } from '../../services/publicScheduleService';
import { tournamentService } from '../../services/tournamentService';
import { InteractiveBracketViewer } from '../tournament/InteractiveBracketViewer';

interface PublicArenaScheduleHubProps {
  initialTournamentId?: string;
  onNavigateToTournamentManagement?: () => void;
}

export const PublicArenaScheduleHub: React.FC<PublicArenaScheduleHubProps> = ({
  initialTournamentId,
  onNavigateToTournamentManagement,
}) => {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(initialTournamentId || '');
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

  const [scheduleData, setScheduleData] = useState<PublicTournamentScheduleSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<RealtimeSyncState>('OFFLINE');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Navigation Sub-Views
  const [activeView, setActiveView] = useState<'arena_matrix' | 'search_athlete' | 'full_schedule' | 'bracket_view'>('arena_matrix');

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<AthleteSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Full Schedule Filters with URL query persistence
  const [courtFilter, setCourtFilter] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const courtParam = params.get('court');
      if (courtParam && courtParam.trim() !== '') {
        return courtParam.trim();
      }
    } catch {
      // Fallback in case of SSR or restricted iframe window
    }
    return 'ALL';
  });
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [genderFilter, setGenderFilter] = useState<string>('ALL');

  const handleCourtFilterChange = (newCourt: string) => {
    setCourtFilter(newCourt);
    try {
      const url = new URL(window.location.href);
      if (newCourt && newCourt !== 'ALL') {
        url.searchParams.set('court', newCourt);
      } else {
        url.searchParams.delete('court');
      }
      window.history.replaceState(null, '', url.toString());
    } catch (err) {
      console.warn('Could not update URL query parameter:', err);
    }
  };

  const handleResetFilters = () => {
    handleCourtFilterChange('ALL');
    setStatusFilter('ALL');
    setGenderFilter('ALL');
  };

  // Kiosk / Fullscreen Mode
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);
  const [kioskActiveCourtIndex, setKioskActiveCourtIndex] = useState<number>(0);

  // 1. Load active / available tournaments
  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        const list = await tournamentService.getTournaments();
        setTournaments(list);
        if (list.length > 0 && !selectedTournamentId) {
          // Prefer ONGOING or REGISTRATION_CLOSED tournament
          const ongoing = list.find((t) => t.status === 'ONGOING' || t.status === 'REGISTRATION_CLOSED');
          const chosen = ongoing || list[0];
          setSelectedTournamentId(chosen.id);
          setSelectedTournament(chosen);
        } else if (selectedTournamentId) {
          const found = list.find((t) => t.id === selectedTournamentId);
          if (found) setSelectedTournament(found);
        }
      } catch (err: any) {
        console.error('Failed to load tournaments:', err);
      }
    };
    fetchTournaments();
  }, [selectedTournamentId]);

  // 2. Fetch authoritative public schedule
  const loadSchedule = useCallback(async (isSilent = false) => {
    if (!selectedTournamentId) return;

    if (!isSilent) setIsLoading(true);
    setError(null);

    try {
      const data = await publicScheduleService.getPublicTournamentSchedule(selectedTournamentId);
      setScheduleData(data);
      setLastRefreshedAt(new Date());
    } catch (err: any) {
      console.error('Error fetching public schedule:', err);
      setError(err.message || 'Failed to load live match schedule.');
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [selectedTournamentId]);

  // Trigger load on tournament change
  useEffect(() => {
    if (selectedTournamentId) {
      loadSchedule(false);
      const found = tournaments.find((t) => t.id === selectedTournamentId);
      if (found) setSelectedTournament(found);
    }
  }, [selectedTournamentId, loadSchedule, tournaments]);

  // 3. Realtime Postgres Changes Subscription
  useEffect(() => {
    if (!selectedTournamentId) return;

    const unsubscribe = publicScheduleService.subscribeToPublicSchedule(
      selectedTournamentId,
      () => {
        loadSchedule(true);
      },
      (newStatus) => {
        setSyncState(newStatus);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [selectedTournamentId, loadSchedule]);

  // 4. Handle Athlete Search
  useEffect(() => {
    if (!selectedTournamentId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await publicScheduleService.searchAthleteSchedule(selectedTournamentId, searchQuery);
        setSearchResults(res);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedTournamentId]);

  // 5. Kiosk Auto-Cycle Timer (Cycles active court every 12s on kiosk mode if multiple courts exist)
  useEffect(() => {
    if (!isKioskMode || !scheduleData?.courts || scheduleData.courts.length <= 1) return;

    const cycleTimer = setInterval(() => {
      setKioskActiveCourtIndex((prev) => (prev + 1) % scheduleData.courts.length);
    }, 12000);

    return () => clearInterval(cycleTimer);
  }, [isKioskMode, scheduleData?.courts]);

  // Filtered Schedule for the Full Schedule list
  const filteredMatches = useMemo(() => {
    if (!scheduleData?.all_matches) return [];
    return scheduleData.all_matches.filter((m) => {
      if (courtFilter !== 'ALL' && m.court_identifier?.toLowerCase() !== courtFilter.toLowerCase()) return false;
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
      if (genderFilter !== 'ALL' && m.gender?.toUpperCase() !== genderFilter.toUpperCase()) return false;
      return true;
    });
  }, [scheduleData?.all_matches, courtFilter, statusFilter, genderFilter]);

  const hasActiveFilters = courtFilter !== 'ALL' || statusFilter !== 'ALL' || genderFilter !== 'ALL';

  return (
    <div className={`space-y-6 ${isKioskMode ? 'fixed inset-0 z-50 bg-slate-950 p-6 overflow-y-auto' : ''}`}>
      {/* Read-Only Public Context Bar & Breadcrumbs (§6.A) */}
      {!isKioskMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs backdrop-blur-sm">
          <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-slate-400">
            <span className="flex items-center gap-1.5 font-medium text-slate-400">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Public Arena</span>
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            <span className="font-semibold text-slate-200">
              {selectedTournament?.name || 'Tournament Hub'}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            <span className="font-bold text-amber-400">
              {activeView === 'arena_matrix' && 'Live Ring Matrix'}
              {activeView === 'search_athlete' && 'Athlete / Team Search'}
              {activeView === 'full_schedule' && 'Full Schedule'}
              {activeView === 'bracket_view' && 'Tournament Brackets'}
            </span>
          </nav>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            {selectedTournament?.status && (
              <span className={`px-2 py-0.5 rounded-md font-bold uppercase ${
                selectedTournament.status === 'LIVE' || selectedTournament.status === 'ACTIVE'
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  : selectedTournament.status === 'COMPLETED'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {selectedTournament.status}
              </span>
            )}
            {activeView === 'arena_matrix' && scheduleData && (
              <span className="text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {scheduleData.courts.length} {scheduleData.courts.length === 1 ? 'Ring' : 'Rings'} Active
              </span>
            )}
            {activeView === 'full_schedule' && (
              <span className="text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {filteredMatches.length} {filteredMatches.length === 1 ? 'Bout' : 'Bouts'} Listed
              </span>
            )}
            {activeView === 'search_athlete' && searchQuery.trim() && (
              <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                Query: &quot;{searchQuery.trim()}&quot;
              </span>
            )}
          </div>
        </div>
      )}

      {/* Header Banner & Live Status Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                <Radio className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  UAAPHIL Live Arena &amp; Schedule Hub
                </h1>
                <p className="text-xs text-slate-400">
                  Public Real-Time Match Schedules, Multi-Ring Boards &amp; Athlete Progress
                </p>
              </div>
            </div>
          </div>

          {/* Controls: Tournament Switcher & Realtime Badge */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-3 md:w-auto">
            {/* Tournament Selector */}
            {tournaments.length > 0 ? (
              <select
                value={selectedTournamentId}
                onChange={(e) => setSelectedTournamentId(e.target.value)}
                className="w-full max-w-full truncate bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 font-semibold sm:w-auto"
              >
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.status})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-slate-400 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 font-mono w-full sm:w-auto truncate">
                No Tournaments Available
              </div>
            )}

            {/* Sync State Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  syncState === 'CONNECTED'
                    ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse'
                    : syncState === 'SYNCING'
                    ? 'bg-amber-400 animate-spin'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-slate-300 font-bold uppercase">{syncState}</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400">{lastRefreshedAt.toLocaleTimeString()}</span>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => loadSchedule(false)}
              disabled={isLoading || !selectedTournamentId}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all disabled:opacity-50"
              title="Refresh Authoritative Schedule"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            </button>

            {/* Fullscreen Kiosk Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsKioskMode(!isKioskMode)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                isKioskMode
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              {isKioskMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  Exit Kiosk
                </>
              ) : (
                <>
                  <Tv className="w-3.5 h-3.5 text-amber-400" />
                  Stadium TV Mode
                </>
              )}
            </button>
          </div>
        </div>

        {/* Global Progress Ticker */}
        {scheduleData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800">
            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-500">Active Rings</div>
              <div className="text-lg font-black text-amber-400">{scheduleData.courts.length}</div>
            </div>
            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-500">Bouts In Progress</div>
              <div className="text-lg font-black text-rose-400 flex items-center gap-1.5">
                <Flame className="w-4 h-4" />
                {scheduleData.in_progress_matches}
              </div>
            </div>
            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-500">On Deck / Queued</div>
              <div className="text-lg font-black text-blue-400">{scheduleData.scheduled_matches}</div>
            </div>
            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-500">Completed Bouts</div>
              <div className="text-lg font-black text-emerald-400">{scheduleData.completed_matches}</div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      {!isKioskMode && (
        <div className="flex flex-wrap gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl">
          <button
            type="button"
            onClick={() => setActiveView('arena_matrix')}
            className={`flex-1 min-w-[120px] py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'arena_matrix'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Live Ring Matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveView('search_athlete')}
            className={`flex-1 min-w-[120px] py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'search_athlete'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Athlete / Team Search
          </button>
          <button
            type="button"
            onClick={() => setActiveView('full_schedule')}
            className={`flex-1 min-w-[120px] py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'full_schedule'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Full Schedule
          </button>
          <button
            type="button"
            onClick={() => setActiveView('bracket_view')}
            className={`flex-1 min-w-[120px] py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'bracket_view'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            Tournament Brackets
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-2xl text-rose-300 text-xs flex items-center gap-3">
          <Shield className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-bold">Schedule Data Error</div>
            <div>{error}</div>
          </div>
          <button
            type="button"
            onClick={() => loadSchedule(false)}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* NO TOURNAMENTS EMPTY STATE */}
      {!isLoading && tournaments.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Inbox className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-100">No Tournaments Found</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              There are currently no tournaments available for public schedule viewing. Once a tournament is scheduled or active, its rings and match cards will appear here.
            </p>
          </div>
          {onNavigateToTournamentManagement && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onNavigateToTournamentManagement}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-md"
              >
                <Layers className="w-4 h-4" />
                Go to Tournament Management
              </button>
            </div>
          )}
        </div>
      )}

      {/* LOADING SKELETON STATE */}
      {isLoading && !scheduleData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden animate-pulse shadow-xl"
              >
                <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                  <div className="h-4 w-28 bg-slate-800 rounded"></div>
                  <div className="h-4 w-20 bg-slate-800 rounded"></div>
                </div>
                <div className="p-5 space-y-5">
                  <div className="space-y-2">
                    <div className="h-3 w-24 bg-slate-800 rounded"></div>
                    <div className="h-24 bg-slate-950/50 border border-slate-800/60 rounded-xl p-3 space-y-2">
                      <div className="h-3 w-3/4 bg-slate-800 rounded"></div>
                      <div className="h-5 bg-slate-800/60 rounded"></div>
                      <div className="h-5 bg-slate-800/60 rounded"></div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-28 bg-slate-800 rounded"></div>
                    <div className="h-16 bg-slate-950/50 border border-slate-800/60 rounded-xl p-3 space-y-2">
                      <div className="h-3 w-1/2 bg-slate-800 rounded"></div>
                      <div className="h-4 bg-slate-800/60 rounded"></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: LIVE ARENA / RING MATRIX */}
      {(activeView === 'arena_matrix' || isKioskMode) && scheduleData && (
        <div className="space-y-6">
          {scheduleData.courts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4 shadow-xl">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Radio className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-100">No Rings Configured for this Tournament</h2>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Court rings have not been initialized or assigned for &quot;{selectedTournament?.name || 'this tournament'}&quot;. When court operations begin, live matches and on-deck queues will broadcast here in real-time.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {scheduleData.courts.map((court) => {
                const nowPlaying = court.now_playing;
                const onDeck = court.on_deck;
                const isIdle = !nowPlaying && !onDeck;

                return (
                  <div
                    key={court.court_id}
                    className={`bg-slate-900 border rounded-2xl overflow-hidden flex flex-col shadow-xl transition-all ${
                      nowPlaying ? 'border-amber-500/30 ring-1 ring-amber-500/10' : 'border-slate-800'
                    }`}
                  >
                    {/* Court Header */}
                    <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            nowPlaying
                              ? 'bg-amber-400 shadow-sm shadow-amber-400 animate-pulse'
                              : onDeck
                              ? 'bg-blue-400'
                              : 'bg-slate-600'
                          }`}
                        />
                        <span className="font-bold text-slate-100 text-sm">{court.court_name}</span>
                        {nowPlaying && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-black uppercase tracking-wider">
                            LIVE
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-800">
                        {court.in_queue_count} {court.in_queue_count === 1 ? 'Bout' : 'Bouts'} In Queue
                      </span>
                    </div>

                    <div className="p-5 space-y-5 flex-1 flex flex-col justify-between">
                      {/* NOW PLAYING SECTION */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-black uppercase text-rose-400 tracking-wider mb-2.5">
                          <span className="flex items-center gap-1.5">
                            <Flame className="w-3.5 h-3.5 animate-pulse" />
                            Now Playing
                          </span>
                          {nowPlaying && (
                            <span className="font-mono text-slate-400">Match #{nowPlaying.match_number}</span>
                          )}
                        </div>

                        {nowPlaying ? (
                          <div className="p-4 bg-rose-950/20 border border-rose-800/40 rounded-xl space-y-3 shadow-inner">
                            <div className="text-[10px] text-slate-400 font-semibold truncate flex items-center justify-between">
                              <span>{nowPlaying.event_name} • {nowPlaying.round_name}</span>
                              <span className="font-mono text-rose-300/80 uppercase text-[9px]">ROUND IN PROGRESS</span>
                            </div>

                            {/* Red vs Blue Matchup */}
                            <div className="space-y-2">
                              {/* Red Corner */}
                              <div className="flex items-center justify-between p-2.5 rounded-lg bg-red-950/30 border-l-4 border-red-500">
                                <div className="truncate pr-2">
                                  <div className="text-xs font-bold text-slate-100 truncate">
                                    {nowPlaying.red_athlete.full_name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {nowPlaying.red_athlete.school_club || 'Independent'}
                                  </div>
                                </div>
                                <span className="text-[10px] font-black text-red-400 uppercase tracking-wider bg-red-950/80 px-2 py-0.5 rounded border border-red-800/60">
                                  RED
                                </span>
                              </div>

                              {/* Blue Corner */}
                              <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-950/30 border-l-4 border-blue-500">
                                <div className="truncate pr-2">
                                  <div className="text-xs font-bold text-slate-100 truncate">
                                    {nowPlaying.blue_athlete.full_name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {nowPlaying.blue_athlete.school_club || 'Independent'}
                                  </div>
                                </div>
                                <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider bg-blue-950/80 px-2 py-0.5 rounded border border-blue-800/60">
                                  BLUE
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-950/40 border border-dashed border-slate-800/90 rounded-xl text-center space-y-1">
                            <div className="text-xs text-slate-400 font-medium">Ring Standby</div>
                            <div className="text-[11px] text-slate-500">No bout currently in progress on this ring.</div>
                          </div>
                        )}
                      </div>

                      {/* ON DECK SECTION */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-black uppercase text-amber-400 tracking-wider mb-2">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            On Deck (Next Bout)
                          </span>
                          {onDeck && <span className="font-mono text-slate-400">Match #{onDeck.match_number}</span>}
                        </div>

                        {onDeck ? (
                          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                            <div className="text-[10px] text-slate-400 font-semibold truncate">
                              {onDeck.event_name} • {onDeck.round_name}
                            </div>
                            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                              <span className="text-red-300 truncate max-w-[45%]">
                                {onDeck.red_athlete.full_name}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">VS</span>
                              <span className="text-blue-300 truncate max-w-[45%] text-right">
                                {onDeck.blue_athlete.full_name}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-slate-950/40 border border-dashed border-slate-800/90 rounded-xl text-center text-xs text-slate-500">
                            {isIdle ? 'Awaiting match dispatch from Court Operations.' : 'No next bout currently queued.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: ATHLETE & TEAM SCHEDULE SEARCH */}
      {activeView === 'search_athlete' && (
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">Athlete &amp; Team Schedule Finder</h2>
                <p className="text-xs text-slate-400">
                  Search by athlete name, university, or martial arts school to locate upcoming ring schedules.
                </p>
              </div>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search athlete name or school/club (e.g. Santos, UST, DLSU, UP)..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 font-semibold transition-colors"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-3 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 px-2 py-0.5 rounded-lg"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Search Empty / Default State */}
          {!searchQuery.trim() && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
                <Users className="w-6 h-6 text-amber-400/80" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-200">Find Athlete or Delegation Schedule</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Type any athlete&apos;s name or school acronym in the search bar above to see assigned rings, match numbers, opponents, and live results.
                </p>
              </div>
            </div>
          )}

          {/* Search Results */}
          {searchQuery.trim() && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-bold">
                <span>Results for &quot;{searchQuery}&quot;</span>
                <span className="font-mono text-slate-300">{searchResults.length} {searchResults.length === 1 ? 'bout' : 'bouts'} found</span>
              </div>

              {isSearching ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2].map((n) => (
                    <div key={n} className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3 animate-pulse">
                      <div className="flex justify-between">
                        <div className="h-4 w-24 bg-slate-800 rounded"></div>
                        <div className="h-4 w-16 bg-slate-800 rounded"></div>
                      </div>
                      <div className="h-5 w-40 bg-slate-800 rounded"></div>
                      <div className="h-16 bg-slate-950 rounded-xl"></div>
                    </div>
                  ))}
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-slate-800 flex items-center justify-center text-slate-500">
                    <Search className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-200">No Matches Found</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      No scheduled or completed bouts found matching &quot;{searchQuery}&quot;. Verify the spelling or try searching by school abbreviation (e.g. UST, DLSU, FEU).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {searchResults.map((res, idx) => {
                    const m = res.match;
                    const isRed = res.corner === 'RED';
                    const opponent = isRed ? m.blue_athlete : m.red_athlete;

                    return (
                      <div
                        key={`${m.id}_${idx}`}
                        className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3 shadow-md hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                isRed ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-blue-950 text-blue-400 border border-blue-800'
                              }`}
                            >
                              {res.corner} CORNER
                            </span>
                            <span className="font-mono text-slate-400">Match #{m.match_number}</span>
                          </div>

                          {/* Status Badge */}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              m.status === 'IN_PROGRESS'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                                : m.status === 'COMPLETED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {m.status === 'IN_PROGRESS' ? 'LIVE NOW' : m.status}
                          </span>
                        </div>

                        <div>
                          <div className="text-sm font-bold text-slate-100">{res.athlete.full_name}</div>
                          <div className="text-xs text-slate-400">{res.athlete.school_club || 'Independent'}</div>
                        </div>

                        <div className="p-3 bg-slate-950 rounded-xl space-y-1.5 text-xs">
                          <div className="text-slate-400 text-[11px]">
                            Event: <span className="text-slate-200 font-semibold">{m.event_name}</span>
                          </div>
                          <div className="text-slate-400 text-[11px]">
                            Assigned Ring: <span className="text-amber-400 font-bold">{m.court_identifier}</span>
                          </div>
                          <div className="text-slate-400 text-[11px]">
                            Opponent: <span className="text-slate-200 font-semibold">{opponent.full_name} ({opponent.school_club || 'Independent'})</span>
                          </div>
                          {res.is_winner && (
                            <div className="text-emerald-400 font-bold text-[11px] flex items-center gap-1 mt-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Match Winner
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setActiveView('bracket_view')}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Trophy className="w-3.5 h-3.5" />
                          View In Bracket Tree
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: FULL TOURNAMENT SCHEDULE LIST */}
      {activeView === 'full_schedule' && scheduleData && (
        <div className="space-y-6">
          {/* Filter Bar */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-wrap items-center gap-3 shadow-md">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
              <Filter className="w-4 h-4 text-amber-400" />
              Filter Schedule:
            </div>

            {/* Court Filter */}
            <select
              value={courtFilter}
              onChange={(e) => handleCourtFilterChange(e.target.value)}
              className="w-full sm:w-auto max-w-full truncate bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">All Rings &amp; Courts</option>
              {scheduleData.courts.map((c) => (
                <option key={c.court_id} value={c.court_identifier}>
                  {c.court_name}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-auto max-w-full truncate bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">All Statuses</option>
              <option value="IN_PROGRESS">Live / In Progress</option>
              <option value="SCHEDULED">Scheduled / Queued</option>
              <option value="COMPLETED">Completed</option>
            </select>

            {/* Gender Filter */}
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="w-full sm:w-auto max-w-full truncate bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">All Genders</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 bg-slate-950 rounded-lg border border-slate-800 transition-colors font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}

            <div className="ml-auto text-xs text-slate-400 font-mono">
              Showing {filteredMatches.length} of {scheduleData.total_matches} bouts
            </div>
          </div>

          {/* Matches Table / Empty State */}
          {filteredMatches.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3 shadow-xl">
              <div className="w-12 h-12 mx-auto rounded-xl bg-slate-800 flex items-center justify-center text-slate-500">
                <Calendar className="w-6 h-6 text-amber-400/80" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-200">No Bouts Found for Current Filters</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {scheduleData.total_matches === 0
                    ? 'No bouts have been scheduled yet for this tournament.'
                    : 'No matches match the selected ring, status, or gender filter.'}
                </p>
              </div>
              {hasActiveFilters && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold rounded-xl transition-all border border-slate-700"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset All Filters
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-black tracking-wider border-b border-slate-800 text-[10px]">
                    <tr>
                      <th className="p-3.5">#</th>
                      <th className="p-3.5">Ring / Court</th>
                      <th className="p-3.5">Event &amp; Round</th>
                      <th className="p-3.5 text-red-400">Red Corner</th>
                      <th className="p-3.5 text-blue-400">Blue Corner</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {filteredMatches.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3.5 font-mono text-amber-400 font-bold">#{m.match_number}</td>
                        <td className="p-3.5 font-semibold text-slate-200">{m.court_identifier}</td>
                        <td className="p-3.5">
                          <div className="font-bold text-slate-200">{m.event_name}</div>
                          <div className="text-[10px] text-slate-400">{m.round_name} • {m.weight_class}</div>
                        </td>
                        <td className="p-3.5">
                          <div className={`font-bold ${m.winner_corner === 'RED' ? 'text-amber-400 font-black' : 'text-slate-200'}`}>
                            {m.red_athlete.full_name}
                          </div>
                          <div className="text-[10px] text-slate-400">{m.red_athlete.school_club}</div>
                        </td>
                        <td className="p-3.5">
                          <div className={`font-bold ${m.winner_corner === 'BLUE' ? 'text-amber-400 font-black' : 'text-slate-200'}`}>
                            {m.blue_athlete.full_name}
                          </div>
                          <div className="text-[10px] text-slate-400">{m.blue_athlete.school_club}</div>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              m.status === 'IN_PROGRESS'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                                : m.status === 'COMPLETED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {m.status === 'IN_PROGRESS' ? 'LIVE' : m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: EMBEDDED O-38 BRACKET VIEWER (READ ONLY) */}
      {activeView === 'bracket_view' && selectedTournament && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl shadow-md">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Trophy className="w-4 h-4 text-amber-400" />
              Tournament Elimination Brackets (O-38 Integration)
            </div>
            <span className="text-[11px] font-mono text-slate-400">100% Read-Only Public Mode</span>
          </div>

          <InteractiveBracketViewer
            tournament={selectedTournament}
            canManage={false}
          />
        </div>
      )}
    </div>
  );
};

