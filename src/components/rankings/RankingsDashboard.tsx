import React, { useState, useEffect } from 'react';
import { rankingsService } from '../../services/rankingsService';
import { tournamentService } from '../../services/tournamentService';
import { 
  TeamMedalTally, 
  AthleteStanding, 
  EventPodium, 
  TournamentStandingsSummary 
} from '../../types/rankings';
import { Tournament, TournamentClosureSeal } from '../../types/tournament';
import { 
  Trophy, 
  Medal, 
  Award, 
  Users, 
  Calendar, 
  RefreshCw, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle,
  Search,
  Filter,
  FileText,
  Lock,
  ShieldCheck,
  Hash,
  Clock,
} from 'lucide-react';

interface RankingsDashboardProps {
  initialTournamentId?: string;
  onNavigateToReports?: (tournamentId?: string) => void;
}

export const RankingsDashboard: React.FC<RankingsDashboardProps> = ({ 
  initialTournamentId,
  onNavigateToReports 
}) => {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(initialTournamentId || '');
  const [activeSubTab, setActiveSubTab] = useState<'team_tally' | 'athlete_standings' | 'event_podiums'>('team_tally');
  
  const [teamTally, setTeamTally] = useState<TeamMedalTally[]>([]);
  const [athleteStandings, setAthleteStandings] = useState<AthleteStanding[]>([]);
  const [eventPodiums, setEventPodiums] = useState<EventPodium[]>([]);
  const [summary, setSummary] = useState<TournamentStandingsSummary | null>(null);
  const [closureSeal, setClosureSeal] = useState<TournamentClosureSeal | null>(null);

  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<'ALL' | 'ANYO' | 'SPARRING'>('ALL');

  useEffect(() => {
    loadTournaments();
  }, []);

  useEffect(() => {
    if (selectedTournamentId) {
      loadRankingsData(selectedTournamentId);
    }
  }, [selectedTournamentId]);

  const loadTournaments = async () => {
    try {
      const data = await tournamentService.getTournaments();
      setTournaments(data || []);
      if (data && data.length > 0 && !selectedTournamentId) {
        setSelectedTournamentId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load tournaments for rankings:', err);
    }
  };

  const loadRankingsData = async (tourneyId: string) => {
    setLoading(true);
    try {
      const [tally, athletes, podiums, sum, seal] = await Promise.all([
        rankingsService.getTeamMedalTally(tourneyId),
        rankingsService.getAthleteStandings(tourneyId),
        rankingsService.getEventPodiums(tourneyId),
        rankingsService.getStandingsSummary(tourneyId),
        tournamentService.getTournamentClosureSeal(tourneyId),
      ]);

      setTeamTally(tally || []);
      setAthleteStandings(athletes || []);
      setEventPodiums(podiums || []);
      setSummary(sum);
      setClosureSeal(seal);
    } catch (err) {
      console.error('Error fetching rankings data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredTeamTally = teamTally.filter(t => 
    t.team_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.school_club.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAthleteStandings = athleteStandings.filter(a => 
    a.athlete_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.team_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredEventPodiums = eventPodiums.filter(e => {
    const matchesSearch = e.event_name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterCategory === 'ANYO') return e.is_anyo;
    if (filterCategory === 'SPARRING') return !e.is_anyo;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Read-Only Public Context Bar & Breadcrumbs (§6.B) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs backdrop-blur-sm">
        <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-zinc-400">
          <span className="flex items-center gap-1.5 font-medium text-zinc-400">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>Public Standings</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-semibold text-zinc-200">
            {tournaments.find(t => t.id === selectedTournamentId)?.name || 'Tournament Hub'}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-bold text-amber-400">
            {activeSubTab === 'team_tally' && 'Team / Club Medal Tally'}
            {activeSubTab === 'athlete_standings' && 'Athlete Standings'}
            {activeSubTab === 'event_podiums' && 'Event Podiums'}
          </span>
        </nav>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          {(() => {
            const currentT = tournaments.find(t => t.id === selectedTournamentId);
            return currentT?.status ? (
              <span className={`px-2 py-0.5 rounded-md font-bold uppercase ${
                currentT.status === 'LIVE' || currentT.status === 'ACTIVE'
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  : currentT.status === 'COMPLETED'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}>
                {currentT.status}
              </span>
            ) : null;
          })()}
          {activeSubTab === 'team_tally' && (
            <span className="text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
              {filteredTeamTally.length} {filteredTeamTally.length === 1 ? 'Team' : 'Teams'} Ranked
            </span>
          )}
          {activeSubTab === 'athlete_standings' && (
            <span className="text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
              {filteredAthleteStandings.length} {filteredAthleteStandings.length === 1 ? 'Athlete' : 'Athletes'} Ranked
            </span>
          )}
          {activeSubTab === 'event_podiums' && (
            <span className="text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
              {filteredEventPodiums.length} {filteredEventPodiums.length === 1 ? 'Podium' : 'Podiums'}
            </span>
          )}
          {searchQuery.trim() && (
            <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              Search: &quot;{searchQuery.trim()}&quot;
            </span>
          )}
        </div>
      </div>

      {/* Header & Tournament Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
              <Trophy className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight text-white uppercase flex items-center gap-2 break-words">
                Official Rankings & Medal Tally
              </h1>
              <p className="text-sm text-zinc-400">
                Authoritative standings derived from finalized Anyo and Sparring competition results.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedTournamentId}
            onChange={(e) => setSelectedTournamentId(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 text-white rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-amber-500 max-w-full truncate"
          >
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status})
              </option>
            ))}
          </select>

          <button
            onClick={() => selectedTournamentId && loadRankingsData(selectedTournamentId)}
            disabled={loading}
            className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl border border-zinc-700 transition shrink-0"
            title="Refresh Standings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onNavigateToReports && (
            <button
              onClick={() => onNavigateToReports(selectedTournamentId)}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 transition shrink-0"
              title="Navigate to Official Reports and Certificates"
            >
              <FileText className="w-4 h-4" />
              <span>Export Official Report</span>
            </button>
          )}
        </div>
      </div>

      {/* Official Closure Seal Card (When Tournament is Finalized & Sealed) */}
      {closureSeal && (
        <div className="bg-gradient-to-r from-amber-950/40 via-zinc-900 to-zinc-900 border border-amber-500/40 p-5 rounded-2xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-900/30 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  Official Tournament Closure Seal
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    SEALED & FROZEN
                  </span>
                </h3>
                <p className="text-xs text-zinc-400">
                  This tournament has concluded and all medal standings are permanently immutable.
                </p>
              </div>
            </div>

            <div className="text-xs text-zinc-400 font-mono">
              <span className="text-zinc-500">Sealed: </span>
              {new Date(closureSeal.finalized_at).toLocaleString()} (UTC)
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
              <span className="font-sans font-semibold text-zinc-400 block text-[11px]">Official Seal Number</span>
              <span className="text-amber-300 font-bold text-xs">{closureSeal.seal_number}</span>
            </div>

            <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
              <span className="font-sans font-semibold text-zinc-400 block text-[11px]">Grand Champion Team</span>
              <span className="text-white font-bold text-xs font-sans">
                {closureSeal.champion_team_name || 'TBD'}
              </span>
            </div>

            <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800 md:col-span-2">
              <span className="font-sans font-semibold text-zinc-400 block text-[11px]">SHA-256 Closure Hash</span>
              <span className="text-zinc-300 text-[10px] break-all">{closureSeal.closure_hash}</span>
            </div>
          </div>

          {closureSeal.signatories && closureSeal.signatories.length > 0 && (
            <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-500">Certified Signatories:</span>
              {closureSeal.signatories.map((sig, sIdx) => (
                <div key={sIdx} className="flex items-center gap-1.5 bg-zinc-950/40 px-2.5 py-1 rounded-lg border border-zinc-800">
                  <span className="text-zinc-400">{sig.role}:</span>
                  <span className="text-amber-300 font-semibold">{sig.name}</span>
                  {sig.title && <span className="text-zinc-500 text-[10px]">({sig.title})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Global Ranking Status Notice */}
      <div className="bg-zinc-950/60 border border-zinc-800/80 px-4 py-2 rounded-xl flex items-center justify-between text-xs text-zinc-500 font-mono">
        <span className="flex items-center gap-2">
          <Award className="w-3.5 h-3.5 text-zinc-600" />
          GLOBAL RANKING STATUS: <span className="text-zinc-400 font-bold">NOT YET ESTABLISHED</span>
        </span>
        <span className="text-[11px] text-zinc-600 font-sans">
          Individual tournament podiums are authoritative. Global aggregate rankings will be established in a future phase.
        </span>
      </div>

      {/* Tournament Summary Ribbon */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Status</div>
            <div className="flex items-center gap-2">
              {summary.is_provisional ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  PROVISIONAL
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  FINAL STANDINGS
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-2">
              {summary.finalized_events} of {summary.total_events} events concluded
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Medal className="w-3.5 h-3.5 text-amber-400" /> Gold Awarded
            </div>
            <div className="text-2xl font-black text-white">{summary.total_gold_awarded}</div>
            <div className="text-xs text-zinc-500 mt-1">Champion Titles</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
            <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Medal className="w-3.5 h-3.5 text-zinc-300" /> Silver Awarded
            </div>
            <div className="text-2xl font-black text-white">{summary.total_silver_awarded}</div>
            <div className="text-xs text-zinc-500 mt-1">Runner-up Titles</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
            <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Medal className="w-3.5 h-3.5 text-amber-700" /> Bronze Awarded
            </div>
            <div className="text-2xl font-black text-white">{summary.total_bronze_awarded}</div>
            <div className="text-xs text-zinc-500 mt-1">3rd Place / Semifinalists</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl col-span-2 md:col-span-1">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-indigo-400" /> Total Medals
            </div>
            <div className="text-2xl font-black text-white">{summary.total_medals_awarded}</div>
            <div className="text-xs text-zinc-500 mt-1">{summary.teams_competing} Teams Competing</div>
          </div>
        </div>
      )}

      {/* Navigation Sub-Tabs & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800 self-start overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveSubTab('team_tally')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeSubTab === 'team_tally'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            Team / Club Medal Tally
          </button>

          <button
            onClick={() => setActiveSubTab('athlete_standings')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeSubTab === 'athlete_standings'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Athlete Standings
          </button>

          <button
            onClick={() => setActiveSubTab('event_podiums')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeSubTab === 'event_podiums'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            Event Podiums ({eventPodiums.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeSubTab === 'event_podiums' && (
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setFilterCategory('ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterCategory === 'ALL' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterCategory('ANYO')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterCategory === 'ANYO' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                }`}
              >
                Anyo
              </button>
              <button
                onClick={() => setFilterCategory('SPARRING')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterCategory === 'SPARRING' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                }`}
              >
                Sparring
              </button>
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search team, athlete, event..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-white text-xs rounded-xl pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* TAB 1: TEAM / CLUB MEDAL TALLY */}
      {activeSubTab === 'team_tally' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 bg-zinc-950/60 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Team Championship Standings (Olympic Standard)
            </h2>
            <span className="text-xs text-zinc-500">
              Ranked by Gold $\rightarrow$ Silver $\rightarrow$ Bronze $\rightarrow$ Total
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-950 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3.5 px-4 w-16 text-center">Rank</th>
                  <th className="py-3.5 px-4">Team / School Club</th>
                  <th className="py-3.5 px-4 text-center w-24 text-amber-400">Gold (🥇)</th>
                  <th className="py-3.5 px-4 text-center w-24 text-zinc-300">Silver (🥈)</th>
                  <th className="py-3.5 px-4 text-center w-24 text-amber-700">Bronze (🥉)</th>
                  <th className="py-3.5 px-4 text-center w-24 font-bold text-white">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredTeamTally.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-zinc-500">
                      No finalized team medal results found for this tournament.
                    </td>
                  </tr>
                ) : (
                  filteredTeamTally.map((team, idx) => (
                    <tr 
                      key={team.team_name} 
                      className={`hover:bg-zinc-800/40 transition ${
                        team.rank === 1 ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <td className="py-4 px-4 text-center font-black">
                        {team.rank === 1 ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-black text-xs font-black shadow-lg shadow-amber-500/20">
                            1
                          </span>
                        ) : team.rank === 2 ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-zinc-300 text-black text-xs font-black">
                            2
                          </span>
                        ) : team.rank === 3 ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-800 text-amber-100 text-xs font-black">
                            3
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-xs">{team.rank_display}</span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-bold text-white">
                        <div className="flex items-center gap-2">
                          {team.team_name}
                          {team.rank === 1 && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              CHAMPION
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-amber-400">
                        {team.gold_count}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-zinc-300">
                        {team.silver_count}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-amber-700">
                        {team.bronze_count}
                      </td>
                      <td className="py-4 px-4 text-center font-black text-white text-base">
                        {team.total_medals}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: ATHLETE STANDINGS */}
      {activeSubTab === 'athlete_standings' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 bg-zinc-950/60 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              Individual Athlete Medal Standings
            </h2>
            <span className="text-xs text-zinc-500">
              Ranked by individual Gold, Silver, Bronze accolades
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-950 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3.5 px-4 w-16 text-center">Rank</th>
                  <th className="py-3.5 px-4">Athlete Name</th>
                  <th className="py-3.5 px-4">Team / Club</th>
                  <th className="py-3.5 px-4 text-center w-20 text-amber-400">🥇 Gold</th>
                  <th className="py-3.5 px-4 text-center w-20 text-zinc-300">🥈 Silver</th>
                  <th className="py-3.5 px-4 text-center w-20 text-amber-700">🥉 Bronze</th>
                  <th className="py-3.5 px-4 text-center w-20 font-bold text-white">Total</th>
                  <th className="py-3.5 px-4 text-center w-24 text-zinc-500">Events Won</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredAthleteStandings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-zinc-500">
                      No finalized athlete medal records found.
                    </td>
                  </tr>
                ) : (
                  filteredAthleteStandings.map((ath) => (
                    <tr key={ath.registration_id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-4 px-4 text-center font-bold text-zinc-400">
                        {ath.rank_display}
                      </td>
                      <td className="py-4 px-4 font-bold text-white">
                        {ath.athlete_name}
                      </td>
                      <td className="py-4 px-4 text-zinc-400">
                        {ath.team_name}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-amber-400">
                        {ath.gold_count}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-zinc-300">
                        {ath.silver_count}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-amber-700">
                        {ath.bronze_count}
                      </td>
                      <td className="py-4 px-4 text-center font-black text-white">
                        {ath.total_medals}
                      </td>
                      <td className="py-4 px-4 text-center text-xs text-zinc-400">
                        {ath.events_won} / {ath.events_participated}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: EVENT PODIUMS */}
      {activeSubTab === 'event_podiums' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredEventPodiums.length === 0 ? (
            <div className="col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500">
              No events match the search/filter criteria.
            </div>
          ) : (
            filteredEventPodiums.map(ev => (
              <div 
                key={ev.event_id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-lg space-y-4"
              >
                <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded mr-2 ${
                      ev.is_anyo 
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {ev.is_anyo ? 'ANYO FORM' : 'FULL CONTACT'}
                    </span>
                    <h3 className="text-base font-bold text-white mt-1">{ev.event_name}</h3>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {ev.gender_category} • {ev.weight_category || 'Form Division'}
                    </div>
                  </div>

                  <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${
                    ev.status === 'FINALIZED' || ev.status === 'COMPLETED'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {ev.status}
                  </span>
                </div>

                {/* Podium Cards */}
                <div className="space-y-2">
                  {/* Gold */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-black">
                        🥇
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">
                          {ev.gold_winner?.athlete_name || 'TBD'}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {ev.gold_winner?.team_name || 'Pending completion'}
                        </div>
                      </div>
                    </div>
                    {ev.gold_winner?.final_score && (
                      <span className="text-xs font-mono font-bold text-amber-400">
                        {ev.gold_winner.final_score.toFixed(2)} pts
                      </span>
                    )}
                  </div>

                  {/* Silver */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/40">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-zinc-300 text-black flex items-center justify-center text-xs font-black">
                        🥈
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">
                          {ev.silver_winner?.athlete_name || 'TBD'}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {ev.silver_winner?.team_name || 'Pending completion'}
                        </div>
                      </div>
                    </div>
                    {ev.silver_winner?.final_score && (
                      <span className="text-xs font-mono font-bold text-zinc-300">
                        {ev.silver_winner.final_score.toFixed(2)} pts
                      </span>
                    )}
                  </div>

                  {/* Bronze */}
                  {ev.bronze_winners.length > 0 ? (
                    ev.bronze_winners.map((bw, bIdx) => (
                      <div key={bIdx} className="flex items-center justify-between p-2.5 rounded-xl bg-amber-900/10 border border-amber-900/20">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-amber-800 text-amber-100 flex items-center justify-center text-xs font-black">
                            🥉
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">{bw.athlete_name}</div>
                            <div className="text-[10px] text-zinc-400">{bw.team_name}</div>
                          </div>
                        </div>
                        {bw.final_score && (
                          <span className="text-xs font-mono font-bold text-amber-700">
                            {bw.final_score.toFixed(2)} pts
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/40 border border-zinc-800">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-500 flex items-center justify-center text-xs font-black">
                          🥉
                        </div>
                        <div className="text-xs text-zinc-500">TBD (Pending Semifinals)</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
